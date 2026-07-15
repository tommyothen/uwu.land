import { apiKeys, links as linksTable } from "@uwu/db/schema";
import {
	type CreateLinkResponse,
	type LinkSummary,
	type ListLinksResponse,
	TIERS
} from "@uwu/shared";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { ipKey, isIpBlocked, recordBannedAttempt } from "./abuse";
import {
	AuthError,
	type AuthOptions,
	type AuthPrincipal,
	resolveAuth
} from "./auth";
import { isBannedHostname } from "./banned";
import { errorResponse } from "./errors";
import { hashKey } from "./keys";
import { reconcileLink } from "./link-reconciliation";
import { normalizeUrl } from "./normalize";
import { DurableObjectFixedWindow } from "./rate-limit";
import {
	generateSlug,
	type IdGenerator,
	isReservedSlug,
	isValidCustomSlug
} from "./slugs";
import type { Env } from "./worker";

const createLinkSchema = z.object({
	url: z.string().max(2048).url(),
	slug: z.string().optional(),
	external_ref: z.string().max(64).optional()
});

const CREATE_WINDOW_SECONDS = 86_400;
const LIST_PAGE_SIZE = 25;

type AuthenticatedPrincipal = Extract<
	AuthPrincipal,
	{ kind: "key" | "session" }
>;
type LinkRow = typeof linksTable.$inferSelect;

export interface LinkHandlersOptions {
	generateId?: IdGenerator;
	auth?: AuthOptions;
	createPerDayLimit?: number;
}

export async function createLink(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const auth = await authOrResponse(c, options.auth);
	if (auth instanceof Response) {
		return auth;
	}

	const body = await readJson(c.req.raw);
	const parsed = createLinkSchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(400, "invalid_body", "Invalid request body.");
	}

	// IP-based abuse blocking applies to anonymous callers only. Authenticated
	// callers (API key or session) share one source IP across many end users (a
	// Discord bot is the motivating case), so an IP block would let one bad actor
	// take down every legitimate user behind that key. Their banned-URL attempts
	// are still rejected below; abusive accounts are dealt with by hand.
	const ip = ipKey(c.req.raw);
	if (auth.kind === "anon" && (await isIpBlocked(c.env.ENFORCEMENT, ip))) {
		return errorResponse(
			403,
			"ip_blocked",
			"This address is temporarily blocked for abuse."
		);
	}

	if (parsed.data.slug !== undefined || parsed.data.external_ref !== undefined) {
		if (auth.kind === "anon") {
			return errorResponse(
				403,
				"forbidden",
				"Custom slugs need an account. Coming soon."
			);
		}
	}

	const destination = new URL(parsed.data.url);
	if (!["http:", "https:"].includes(destination.protocol)) {
		return errorResponse(400, "invalid_body", "URL must use http or https.");
	}
	if (destination.username !== "" || destination.password !== "") {
		return errorResponse(400, "invalid_body", "URL credentials are not allowed.");
	}

	if (isOwnHostname(destination.hostname)) {
		return errorResponse(400, "invalid_body", "uwu.land URLs are not allowed.");
	}

	if (await isBannedHostname(c.env.UWU, destination.hostname)) {
		if (auth.kind === "anon") {
			await recordBannedAttempt(c.env.ENFORCEMENT, ip);
		}
		return errorResponse(400, "url_banned", "URL host is banned.");
	}

	const rateLimit = await limitCreate(c, auth, options.createPerDayLimit);
	if (!rateLimit.allowed) {
		return errorResponse(
			429,
			"rate_limited",
			"Rate limit exceeded.",
			rateLimit.retryAfterSeconds
		);
	}

	if (auth.kind === "anon") {
		const urlHash = await hashKey(normalizeUrl(destination.toString()));
		const urlMapKey = `urlmap:${urlHash}`;
		const [reserved] = await drizzle(c.env.DB).select().from(linksTable).where(eq(linksTable.urlHash, urlHash)).limit(1).all();
		if (reserved !== undefined && reserved.lifecycleState !== "pending_delete") {
			if (reserved.lifecycleState === "pending_publish" || (await c.env.UWU.get(reserved.slug)) === null) {
				const pending = { ...reserved, lifecycleState: "pending_publish" as const };
				if (reserved.lifecycleState === "active") await drizzle(c.env.DB).update(linksTable).set({ lifecycleState: "pending_publish" }).where(eq(linksTable.slug, reserved.slug)).run();
				try { await reconcileLink(c.env, pending); } catch { return publicationPending(); }
			}
			return createdLinkResponse(reserved.slug, destination.toString());
		}
		const mappedSlug = await c.env.UWU.get(urlMapKey);
		if (mappedSlug !== null && (await c.env.UWU.get(mappedSlug)) !== null) {
			return createdLinkResponse(mappedSlug, destination.toString());
		}

		const slug = await generateSlug(c.env.UWU, options.generateId);
		await drizzle(c.env.DB)
			.insert(linksTable)
			.values({
				slug,
				url: destination.toString(),
				ownerId: null,
				externalRef: null,
				source: "web-anon",
				lifecycleState: "pending_publish",
				urlHash
			})
			.run();
		const row = await findLink(c.env.DB, slug);
		if (row === null) throw new Error("Created link disappeared");
		try { await reconcileLink(c.env, row); } catch { return publicationPending(); }
		return createdLinkResponse(slug, destination.toString());
	}

	const db = drizzle(c.env.DB);
	const slug =
		parsed.data.slug === undefined
			? await generateAvailableSlug(c.env, db, options.generateId)
			: await validateCustomSlug(c.env, db, parsed.data.slug);
	if (slug instanceof Response) {
		return slug;
	}

	try {
		await db
			.insert(linksTable)
			.values({
				slug,
				url: destination.toString(),
				ownerId: auth.userId,
				externalRef: parsed.data.external_ref ?? null,
				source: sourceForAuth(auth),
				lifecycleState: "pending_publish"
			})
			.run();
	} catch {
		return errorResponse(409, "slug_taken", "Slug is already taken.");
	}

	const row = await findLink(c.env.DB, slug);
	if (row === null) throw new Error("Created link disappeared");
	try { await reconcileLink(c.env, row); } catch { return publicationPending(); }
	return createdLinkResponse(slug, destination.toString());
}

export async function listLinks(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const auth = await requireAuth(c, options.auth);
	if (auth instanceof Response) {
		return auth;
	}

	const cursor = decodeCursor(c.req.query("cursor"));
	if (cursor instanceof Response) {
		return cursor;
	}

	const externalRef = c.req.query("external_ref");
	const db = drizzle(c.env.DB);
	const conditions = [eq(linksTable.ownerId, auth.userId)];
	if (externalRef !== undefined) {
		conditions.push(eq(linksTable.externalRef, externalRef));
	}
	if (cursor !== null) {
		const cursorCondition = or(
			lt(linksTable.createdAt, cursor.createdAt),
			and(
				eq(linksTable.createdAt, cursor.createdAt),
				lt(linksTable.slug, cursor.slug)
			)
		);
		if (cursorCondition !== undefined) {
			conditions.push(cursorCondition);
		}
	}

	const rows = await db
		.select()
		.from(linksTable)
		.where(and(...conditions))
		.orderBy(desc(linksTable.createdAt), desc(linksTable.slug))
		.limit(LIST_PAGE_SIZE + 1)
		.all();
	const pageRows = rows.slice(0, LIST_PAGE_SIZE);
	const last = pageRows.at(-1);
	const response: ListLinksResponse = {
		links: pageRows.map(linkSummary)
	};
	if (rows.length > LIST_PAGE_SIZE && last !== undefined) {
		response.cursor = encodeCursor(last);
	}

	return Response.json(response);
}

export async function getLink(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const auth = await requireAuth(c, options.auth);
	if (auth instanceof Response) {
		return auth;
	}

	const slug = c.req.param("slug");
	if (slug === undefined) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	const row = await findLink(c.env.DB, slug);
	if (row === null) {
		return errorResponse(404, "not_found", "Link not found.");
	}
	if (row.ownerId !== auth.userId) {
		return errorResponse(403, "forbidden", "Link belongs to another user.");
	}

	return Response.json(linkSummary(row));
}

export async function deleteLink(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const auth = await requireAuth(c, options.auth);
	if (auth instanceof Response) {
		return auth;
	}

	const slug = c.req.param("slug");
	if (slug === undefined) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	const row = await findLink(c.env.DB, slug);
	if (row === null) {
		return errorResponse(404, "not_found", "Link not found.");
	}
	if (row.ownerId !== auth.userId) {
		return errorResponse(403, "forbidden", "Link belongs to another user.");
	}

	await drizzle(c.env.DB)
		.update(linksTable)
		.set({ lifecycleState: "pending_delete" })
		.where(eq(linksTable.slug, slug))
		.run();
	const pending = { ...row, lifecycleState: "pending_delete" as const };
	try { await reconcileLink(c.env, pending); } catch { /* scheduled reconciliation owns the retry */ }
	return new Response(null, { status: 204 });
}

export async function me(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const auth = await requireAuth(c, options.auth);
	if (auth instanceof Response) {
		return auth;
	}
	const limiter = createLimiter(c, auth, options.createPerDayLimit);
	const [createUsage, activeApiKeys, billingCustomer] = await Promise.all([
		limiter.usage(scopeKey(c, auth)),
		drizzle(c.env.DB)
			.select({ id: apiKeys.id })
			.from(apiKeys)
			.where(and(eq(apiKeys.userId, auth.userId), isNull(apiKeys.revokedAt)))
			.all(),
		auth.kind === "session"
			? c.env.DB.prepare(
					"SELECT 1 FROM stripe_customers WHERE user_id = ? LIMIT 1"
				)
					.bind(auth.userId)
					.first()
			: Promise.resolve(null)
	]);

	return Response.json({
		user_id: auth.userId,
		tier: auth.tier,
		hasBillingHistory: billingCustomer !== null,
		limits: {
			...TIERS[auth.tier],
			createPerDay: effectiveCreatePerDay(auth)
		},
		usage: {
			createdToday: createUsage?.count ?? 0,
			apiKeys: activeApiKeys.length,
			resetAt:
				createUsage === null ? null : new Date(createUsage.resetAt).toISOString()
		}
	});
}

export async function linkStats(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const slug = c.req.param("slug");
	if (slug === undefined) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	if ((await c.env.UWU.get(slug)) === null) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	const clicks = Number.parseInt((await c.env.CLICKS.get(slug)) ?? "0", 10);
	return Response.json({
		slug,
		clicks: Number.isFinite(clicks) ? clicks : 0
	});
}

async function authOrResponse(
	c: Context<{ Bindings: Env }>,
	options?: AuthOptions
): Promise<AuthPrincipal | Response> {
	try {
		return await resolveAuth(c.req.raw, c.env, c.executionCtx, options);
	} catch (error) {
		if (error instanceof AuthError) {
			return errorResponse(401, "unauthorized", "Unauthorized.");
		}
		throw error;
	}
}

async function requireAuth(
	c: Context<{ Bindings: Env }>,
	options?: AuthOptions
): Promise<AuthenticatedPrincipal | Response> {
	const auth = await authOrResponse(c, options);
	if (auth instanceof Response) {
		return auth;
	}
	if (auth.kind === "anon") {
		return errorResponse(401, "unauthorized", "Authentication required.");
	}
	return auth;
}

async function limitCreate(
	c: Context<{ Bindings: Env }>,
	auth: AuthPrincipal,
	createPerDayLimit?: number
): ReturnType<DurableObjectFixedWindow["limit"]> {
	return createLimiter(c, auth, createPerDayLimit).limit(scopeKey(c, auth));
}

function createLimiter(
	c: Context<{ Bindings: Env }>,
	auth: AuthPrincipal,
	createPerDayLimit?: number
): DurableObjectFixedWindow {
	return new DurableObjectFixedWindow(
		c.env.ENFORCEMENT,
		createPerDayLimit ?? effectiveCreatePerDay(auth),
		CREATE_WINDOW_SECONDS
	);
}

function effectiveCreatePerDay(auth: AuthPrincipal): number {
	if (
		auth.kind !== "anon" &&
		auth.limitedUntil !== null &&
		auth.limitedUntil.getTime() > Date.now()
	) {
		return TIERS.anon.createPerDay;
	}
	const tier = auth.kind === "anon" ? "anon" : auth.tier;
	return TIERS[tier].createPerDay;
}

function scopeKey(c: Context<{ Bindings: Env }>, auth: AuthPrincipal): string {
	if (auth.kind === "anon") {
		return `anon:${ipKey(c.req.raw)}`;
	}
	if (auth.emailHash !== null) {
		return `identity:${auth.emailHash}`;
	}
	return `user:${auth.userId}`;
}

async function validateCustomSlug(
	env: Env,
	db: ReturnType<typeof drizzle>,
	slug: string
): Promise<string | Response> {
	if (isReservedSlug(slug)) {
		return errorResponse(400, "slug_reserved", "Slug is reserved.");
	}
	if (!isValidCustomSlug(slug)) {
		return errorResponse(400, "invalid_body", "Invalid slug.");
	}
	if (await slugExists(env, db, slug)) {
		return errorResponse(409, "slug_taken", "Slug is already taken.");
	}
	return slug;
}

async function generateAvailableSlug(
	env: Env,
	db: ReturnType<typeof drizzle>,
	generateId: IdGenerator = () => nanoid(5),
	maxAttempts = 20
): Promise<string> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const slug = generateId();
		if (!isReservedSlug(slug) && !(await slugExists(env, db, slug))) {
			return slug;
		}
	}

	throw new Error("Unable to generate a unique slug");
}

async function slugExists(
	env: Env,
	db: ReturnType<typeof drizzle>,
	slug: string
): Promise<boolean> {
	if ((await env.UWU.get(slug)) !== null) {
		return true;
	}
	return (await findLinkRow(db, slug)) !== null;
}

async function findLink(dbBinding: D1Database, slug: string): Promise<LinkRow | null> {
	return findLinkRow(drizzle(dbBinding), slug);
}

async function findLinkRow(
	db: ReturnType<typeof drizzle>,
	slug: string
): Promise<LinkRow | null> {
	const [row] = await db
		.select()
		.from(linksTable)
		.where(eq(linksTable.slug, slug))
		.limit(1)
		.all();
	return row ?? null;
}

function linkSummary(row: LinkRow): LinkSummary {
	const summary: LinkSummary = {
		slug: row.slug,
		short_url: `https://uwu.land/${row.slug}`,
		url: row.url,
		clicks: row.clicks,
		created_at: row.createdAt.toISOString()
	};
	if (row.externalRef !== null) {
		summary.external_ref = row.externalRef;
	}
	return summary;
}

function sourceForAuth(auth: AuthPrincipal): "web-anon" | "api" | "dashboard" {
	if (auth.kind === "anon") {
		return "web-anon";
	}
	if (auth.kind === "key") {
		return "api";
	}
	return "dashboard";
}

function encodeCursor(row: LinkRow): string {
	return base64UrlEncode(
		JSON.stringify({
			created_at: row.createdAt.toISOString(),
			slug: row.slug
		})
	);
}

function decodeCursor(
	value: string | undefined
): { createdAt: Date; slug: string } | Response | null {
	if (value === undefined) {
		return null;
	}

	try {
		const parsed = JSON.parse(base64UrlDecode(value)) as Partial<{
			created_at: string;
			slug: string;
		}>;
		if (
			typeof parsed.created_at !== "string" ||
			typeof parsed.slug !== "string"
		) {
			return errorResponse(400, "invalid_body", "Invalid cursor.");
		}
		const createdAt = new Date(parsed.created_at);
		if (!Number.isFinite(createdAt.getTime())) {
			return errorResponse(400, "invalid_body", "Invalid cursor.");
		}
		return { createdAt, slug: parsed.slug };
	} catch {
		return errorResponse(400, "invalid_body", "Invalid cursor.");
	}
}

function base64UrlEncode(value: string): string {
	return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		"="
	);
	return atob(padded);
}

function createdLinkResponse(slug: string, url: string): Response {
	return Response.json({ slug, short_url: `https://uwu.land/${slug}`, url } satisfies CreateLinkResponse, { status: 201 });
}

function publicationPending(): Response {
	return errorResponse(503, "publication_pending", "Link publication is pending. Retry the same request shortly.");
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

function isOwnHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return lower === "uwu.land" || lower.endsWith(".uwu.land");
}
