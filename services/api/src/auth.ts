import { verifyJwt } from "@clerk/backend/jwt";
import { apiKeys, users } from "@uwu/db/schema";
import type { TierKey } from "@uwu/shared";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./errors";
import { hashKey } from "./keys";
import type { Env } from "./worker";

const DEFAULT_CLERK_ISSUER = "TODO-clerk-issuer";
const LAST_USED_STAMP_INTERVAL_MS = 60 * 60 * 1000;

type UserTier = Exclude<TierKey, "anon">;

interface WaitUntilContext {
	waitUntil(promise: Promise<unknown>): void;
}

interface JwkWithKid extends JsonWebKey {
	kid?: string;
}

export interface TestJwks {
	keys: JwkWithKid[];
}

export type AuthPrincipal =
	| { kind: "anon" }
	| { kind: "key"; userId: string; keyId: string; tier: UserTier }
	| { kind: "session"; userId: string; tier: UserTier };

export interface AuthOptions {
	clerkIssuer?: string;
	jwks?: TestJwks;
	now?: () => Date;
}

export class AuthError extends Error {
	constructor() {
		super("Unauthorized");
		this.name = "AuthError";
	}
}

export async function resolveAuth(
	request: Request,
	env: Env,
	ctx: WaitUntilContext,
	options: AuthOptions = {}
): Promise<AuthPrincipal> {
	const token = bearerToken(request);
	if (token === null) {
		return { kind: "anon" };
	}

	if (token.startsWith("uwu_")) {
		return resolveApiKey(token, env, ctx, options);
	}

	return resolveClerkSession(token, env, options);
}

export function authMiddleware(
	options: AuthOptions = {}
): MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthPrincipal } }> {
	return async (c, next) => {
		try {
			c.set(
				"auth",
				await resolveAuth(c.req.raw, c.env, c.executionCtx, options)
			);
			await next();
		} catch (error) {
			if (error instanceof AuthError) {
				return errorResponse(401, "unauthorized", "Unauthorized.");
			}
			throw error;
		}
	};
}

async function resolveApiKey(
	secret: string,
	env: Env,
	ctx: WaitUntilContext,
	options: AuthOptions
): Promise<AuthPrincipal> {
	const db = drizzle(env.DB);
	const hash = await hashKey(secret);
	const [row] = await db
		.select({
			keyId: apiKeys.id,
			lastUsedAt: apiKeys.lastUsedAt,
			tier: users.tier,
			userId: users.id
		})
		.from(apiKeys)
		.innerJoin(users, eq(apiKeys.userId, users.id))
		.where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
		.limit(1)
		.all();

	if (row === undefined) {
		throw new AuthError();
	}

	const now = options.now?.() ?? new Date();
	if (shouldStampLastUsed(row.lastUsedAt, now)) {
		ctx.waitUntil(
			db
				.update(apiKeys)
				.set({ lastUsedAt: now })
				.where(eq(apiKeys.id, row.keyId))
				.run()
		);
	}

	return {
		kind: "key",
		keyId: row.keyId,
		tier: row.tier,
		userId: row.userId
	};
}

async function resolveClerkSession(
	token: string,
	env: Env,
	options: AuthOptions
): Promise<AuthPrincipal> {
	const issuer = options.clerkIssuer ?? env.CLERK_ISSUER ?? DEFAULT_CLERK_ISSUER;
	const key = findJwk(token, options.jwks);
	let payload: Awaited<ReturnType<typeof verifyJwt>>;
	try {
		payload = await verifyJwt(token, {
			key,
			headerType: "JWT"
		});
	} catch {
		throw new AuthError();
	}

	if (payload.iss !== issuer || typeof payload.sub !== "string") {
		throw new AuthError();
	}

	const db = drizzle(env.DB);
	await db.insert(users).values({ id: payload.sub }).onConflictDoNothing().run();
	const [user] = await db
		.select({ id: users.id, tier: users.tier })
		.from(users)
		.where(eq(users.id, payload.sub))
		.limit(1)
		.all();

	if (user === undefined) {
		throw new AuthError();
	}

	return {
		kind: "session",
		tier: user.tier,
		userId: user.id
	};
}

function bearerToken(request: Request): string | null {
	const authorization = request.headers.get("authorization");
	if (authorization === null) {
		return null;
	}

	const match = /^Bearer\s+(.+)$/i.exec(authorization);
	if (match === null || match[1]?.trim() === "") {
		throw new AuthError();
	}
	const token = match[1];
	if (token === undefined) {
		throw new AuthError();
	}
	return token;
}

function shouldStampLastUsed(lastUsedAt: Date | null, now: Date): boolean {
	return (
		lastUsedAt === null ||
		now.getTime() - lastUsedAt.getTime() >= LAST_USED_STAMP_INTERVAL_MS
	);
}

function findJwk(token: string, jwks: TestJwks | undefined): JsonWebKey {
	if (jwks === undefined) {
		throw new AuthError();
	}

	const header = decodeJwtPart(token.split(".")[0]);
	const kid = typeof header.kid === "string" ? header.kid : null;
	const key = jwks.keys.find((candidate) => candidate.kid === kid);
	if (key === undefined) {
		throw new AuthError();
	}
	return key;
}

function decodeJwtPart(part: string | undefined): Record<string, unknown> {
	if (part === undefined) {
		throw new AuthError();
	}

	try {
		const normalized = part.replaceAll("-", "+").replaceAll("_", "/");
		const padded = normalized.padEnd(
			normalized.length + ((4 - (normalized.length % 4)) % 4),
			"="
		);
		return JSON.parse(atob(padded)) as Record<string, unknown>;
	} catch {
		throw new AuthError();
	}
}
