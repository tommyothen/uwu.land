import { apiKeys } from "@uwu/db/schema";
import { TIERS } from "@uwu/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { z } from "zod";
import {
	AuthError,
	type AuthOptions,
	type AuthPrincipal,
	resolveAuth
} from "./auth";
import { errorResponse } from "./errors";
import { generateApiKey } from "./keys";
import type { Env } from "./worker";

const createKeySchema = z.object({
	name: z.string().trim().min(1).max(80)
});

type SessionPrincipal = Extract<AuthPrincipal, { kind: "session" }>;

export interface KeyRouteOptions {
	auth?: AuthOptions;
}

export async function createKey(
	c: Context<{ Bindings: Env }>,
	options: KeyRouteOptions = {}
): Promise<Response> {
	const auth = await requireSession(c, options);
	if (auth instanceof Response) {
		return auth;
	}

	const body = await readJson(c.req.raw);
	const parsed = createKeySchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(400, "invalid_body", "Invalid request body.");
	}

	const db = drizzle(c.env.DB);
	const existing = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, auth.userId), isNull(apiKeys.revokedAt)))
		.all();
	if (existing.length >= TIERS[auth.tier].apiKeys) {
		return errorResponse(409, "key_limit", "API key limit reached.");
	}

	const generated = await generateApiKey();
	const id = crypto.randomUUID();
	await db
		.insert(apiKeys)
		.values({
			id,
			userId: auth.userId,
			name: parsed.data.name,
			keyHash: generated.hash,
			displayPrefix: generated.displayPrefix
		})
		.run();

	return Response.json(
		{
			id,
			name: parsed.data.name,
			secret: generated.secret,
			display_prefix: generated.displayPrefix
		},
		{ status: 201 }
	);
}

export async function listKeys(
	c: Context<{ Bindings: Env }>,
	options: KeyRouteOptions = {}
): Promise<Response> {
	const auth = await requireSession(c, options);
	if (auth instanceof Response) {
		return auth;
	}

	const rows = await drizzle(c.env.DB)
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			displayPrefix: apiKeys.displayPrefix,
			createdAt: apiKeys.createdAt,
			lastUsedAt: apiKeys.lastUsedAt
		})
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, auth.userId), isNull(apiKeys.revokedAt)))
		.orderBy(desc(apiKeys.createdAt))
		.all();

	return Response.json({
		keys: rows.map((row) => ({
			id: row.id,
			name: row.name,
			display_prefix: row.displayPrefix,
			created_at: row.createdAt.toISOString(),
			last_used_at: row.lastUsedAt?.toISOString() ?? null
		}))
	});
}

export async function deleteKey(
	c: Context<{ Bindings: Env }>,
	options: KeyRouteOptions = {}
): Promise<Response> {
	const auth = await requireSession(c, options);
	if (auth instanceof Response) {
		return auth;
	}

	const id = c.req.param("id");
	if (id === undefined) {
		return errorResponse(404, "not_found", "API key not found.");
	}

	const db = drizzle(c.env.DB);
	const [row] = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, auth.userId)))
		.limit(1)
		.all();
	if (row === undefined) {
		return errorResponse(404, "not_found", "API key not found.");
	}

	await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(eq(apiKeys.id, id))
		.run();
	return new Response(null, { status: 204 });
}

async function requireSession(
	c: Context<{ Bindings: Env }>,
	options: KeyRouteOptions
): Promise<SessionPrincipal | Response> {
	let auth: AuthPrincipal;
	try {
		auth = await resolveAuth(c.req.raw, c.env, c.executionCtx, options.auth);
	} catch (error) {
		if (error instanceof AuthError) {
			return errorResponse(401, "unauthorized", "Unauthorized.");
		}
		throw error;
	}

	if (auth.kind === "anon") {
		return errorResponse(401, "unauthorized", "Authentication required.");
	}
	if (auth.kind === "key") {
		return errorResponse(403, "forbidden", "API keys cannot manage keys.");
	}
	return auth;
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
