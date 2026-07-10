import { links as linksTable } from "@uwu/db/schema";
import {
	type CreateLinkResponse,
	type LinkSummary,
	type ListLinksResponse,
	TIERS
} from "@uwu/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AuthError, type AuthPrincipal, resolveAuth } from "./auth";
import { isBannedHostname } from "./banned";
import { errorResponse } from "./errors";
import { KvFixedWindow } from "./rate-limit";
import {
	generateSlug,
	type IdGenerator,
	isReservedSlug,
	isValidCustomSlug
} from "./slugs";
import type { Env } from "./worker";

const createLinkSchema = z.object({
	url: z.string().url(),
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
}

export async function createLink(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const auth = await authOrResponse(c);
	if (auth instanceof Response) {
		return auth;
	}

	const body = await readJson(c.req.raw);
	const parsed = createLinkSchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(400, "invalid_body", "Invalid request body.");
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

	if (isOwnHostname(destination.hostname)) {
		return errorResponse(400, "invalid_body", "uwu.land URLs are not allowed.");
	}

	if (await isBannedHostname(c.env.UWU, destination.hostname)) {
		return errorResponse(400, "url_banned", "URL host is banned.");
	}

	if (!(await limitCreate(c, auth))) {
		return errorResponse(429, "rate_limited", "Rate limit exceeded.");
	}

	if (auth.kind === "anon") {
		const slug = await generateSlug(c.env.UWU, options.generateId);
		await c.env.UWU.put(slug, destination.toString());
		await c.env.CLICKS.put(slug, "0");

		const response: CreateLinkResponse = {
			slug,
			short_url: `https://uwu.land/${slug}`,
			url: destination.toString()
		};
		return Response.json(response, { status: 201 });
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
				source: sourceForAuth(auth)
			})
			.run();
	} catch {
		return errorResponse(409, "slug_taken", "Slug is already taken.");
	}

	await c.env.UWU.put(slug, destination.toString());
	await c.env.CLICKS.put(slug, "0");

	const response: CreateLinkResponse = {
		slug,
		short_url: `https://uwu.land/${slug}`,
		url: destination.toString()
	};
	return Response.json(response, { status: 201 });
}

export async function listLinks(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const auth = await requireAuth(c);
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
		links: await Promise.all(pageRows.map((row) => linkSummary(c.env, row)))
	};
	if (rows.length > LIST_PAGE_SIZE && last !== undefined) {
		response.cursor = encodeCursor(last);
	}

	return Response.json(response);
}

export async function getLink(c: Context<{ Bindings: Env }>): Promise<Response> {
	const auth = await requireAuth(c);
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

	return Response.json(await linkSummary(c.env, row));
}

export async function deleteLink(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const auth = await requireAuth(c);
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
		.delete(linksTable)
		.where(eq(linksTable.slug, slug))
		.run();
	await Promise.all([c.env.UWU.delete(slug), c.env.CLICKS.delete(slug)]);
	return new Response(null, { status: 204 });
}

export async function me(c: Context<{ Bindings: Env }>): Promise<Response> {
	const auth = await requireAuth(c);
	if (auth instanceof Response) {
		return auth;
	}

	return Response.json({
		user_id: auth.userId,
		tier: auth.tier,
		limits: TIERS[auth.tier]
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
	c: Context<{ Bindings: Env }>
): Promise<AuthPrincipal | Response> {
	try {
		return await resolveAuth(c.req.raw, c.env, c.executionCtx);
	} catch (error) {
		if (error instanceof AuthError) {
			return errorResponse(401, "unauthorized", "Unauthorized.");
		}
		throw error;
	}
}

async function requireAuth(
	c: Context<{ Bindings: Env }>
): Promise<AuthenticatedPrincipal | Response> {
	const auth = await authOrResponse(c);
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
	auth: AuthPrincipal
): Promise<boolean> {
	const tier = auth.kind === "anon" ? "anon" : auth.tier;
	const limiter = new KvFixedWindow(
		c.env.UWU,
		TIERS[tier].createPerDay,
		CREATE_WINDOW_SECONDS
	);
	return limiter.limit(scopeKey(c, auth));
}

function scopeKey(c: Context<{ Bindings: Env }>, auth: AuthPrincipal): string {
	if (auth.kind === "anon") {
		const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
		return `anon:${ip}`;
	}
	if (auth.kind === "key") {
		return `key:${auth.keyId}`;
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

async function linkSummary(env: Env, row: LinkRow): Promise<LinkSummary> {
	const clicksRaw = await env.CLICKS.get(row.slug);
	const clicks = Number.parseInt(clicksRaw ?? "0", 10);
	const summary: LinkSummary = {
		slug: row.slug,
		short_url: `https://uwu.land/${row.slug}`,
		url: row.url,
		clicks: Number.isFinite(clicks) ? clicks : 0,
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
