import { verifyJwt } from "@clerk/backend/jwt";
import { apiKeys, users } from "@uwu/db/schema";
import type { TierKey } from "@uwu/shared";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import { insertUserUnlessDeleted, isDeletedUser } from "./deletion";
import { errorResponse } from "./errors";
import { hashKey } from "./keys";
import type { Env } from "./worker";

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
	| {
			kind: "key";
			userId: string;
			keyId: string;
			tier: UserTier;
			emailHash: string | null;
			limitedUntil: Date | null;
	  }
	| {
			kind: "session";
			userId: string;
			tier: UserTier;
			emailHash: string | null;
			limitedUntil: Date | null;
	  };

export interface AuthOptions {
	clerkIssuer?: string;
	jwks?: TestJwks;
	fetchJwks?: (url: string) => Promise<TestJwks>;
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
			emailHash: users.emailHash,
			keyId: apiKeys.id,
			lastUsedAt: apiKeys.lastUsedAt,
			limitedUntil: users.limitedUntil,
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
		emailHash: row.emailHash,
		kind: "key",
		keyId: row.keyId,
		limitedUntil: row.limitedUntil,
		tier: row.tier,
		userId: row.userId
	};
}

async function resolveClerkSession(
	token: string,
	env: Env,
	options: AuthOptions
): Promise<AuthPrincipal> {
	const issuer = options.clerkIssuer ?? env.CLERK_ISSUER;
	const key =
		options.jwks === undefined
			? await findRemoteJwk(token, issuer, options)
			: findJwk(token, options.jwks);
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

	// A session JWT can outlive account deletion; it must not recreate the user.
	if (await isDeletedUser(env.DB, payload.sub)) {
		throw new AuthError();
	}

	// The check above is a cheap fast path with a race: a deletion can commit
	// between it and this insert. Folding the guard into the statement makes
	// the write itself atomic against that race; the re-select below then
	// comes back empty and the session is rejected.
	await insertUserUnlessDeleted(env.DB, payload.sub);
	const db = drizzle(env.DB);
	const [user] = await db
		.select({
			emailHash: users.emailHash,
			id: users.id,
			limitedUntil: users.limitedUntil,
			tier: users.tier
		})
		.from(users)
		.where(eq(users.id, payload.sub))
		.limit(1)
		.all();

	if (user === undefined) {
		throw new AuthError();
	}

	return {
		emailHash: user.emailHash,
		kind: "session",
		limitedUntil: user.limitedUntil,
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

function findJwk(token: string, jwks: TestJwks): JsonWebKey {
	const key = tryFindJwk(token, jwks);
	if (key === null) {
		throw new AuthError();
	}
	return key;
}

function tryFindJwk(token: string, jwks: TestJwks): JsonWebKey | null {
	const header = decodeJwtPart(token.split(".")[0]);
	const kid = typeof header.kid === "string" ? header.kid : null;
	return jwks.keys.find((candidate) => candidate.kid === kid) ?? null;
}

// Cached per isolate; a kid miss triggers one refetch so key rotation works.
const jwksCache = new Map<string, TestJwks>();

async function findRemoteJwk(
	token: string,
	issuer: string,
	options: AuthOptions
): Promise<JsonWebKey> {
	const url = `${issuer}/.well-known/jwks.json`;
	const cached = jwksCache.get(url);
	if (cached !== undefined) {
		const key = tryFindJwk(token, cached);
		if (key !== null) {
			return key;
		}
	}

	const fetchJwks = options.fetchJwks ?? defaultFetchJwks;
	let fresh: TestJwks;
	try {
		fresh = await fetchJwks(url);
	} catch {
		throw new AuthError();
	}
	jwksCache.set(url, fresh);
	return findJwk(token, fresh);
}

async function defaultFetchJwks(url: string): Promise<TestJwks> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new AuthError();
	}
	return (await response.json()) as TestJwks;
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
