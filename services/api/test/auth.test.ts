import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { apiKeys, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { authMiddleware, resolveAuth, type TestJwks } from "../src/auth";
import { generateApiKey, hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import { resetD1 } from "./helpers/d1";

type Tier = "free" | "pro";

const issuer = "https://clerk.test";

async function seedUser(
	id = "user_123",
	tier: Tier = "free",
	emailHash: string | null = null,
	limitedUntil: Date | null = null
) {
	const db = drizzle(env.DB);
	await db.insert(users).values({ id, tier, emailHash, limitedUntil }).run();
}

async function seedApiKey({
	id = "key_123",
	userId = "user_123",
	secret = "uwu_testSecret000000000000000000",
	revokedAt = null,
	lastUsedAt = null
}: {
	id?: string;
	userId?: string;
	secret?: string;
	revokedAt?: Date | null;
	lastUsedAt?: Date | null;
} = {}) {
	const db = drizzle(env.DB);
	await db.insert(apiKeys)
		.values({
			id,
			userId,
			name: "Test key",
			keyHash: await hashKey(secret),
			displayPrefix: secret.slice(0, 12),
			revokedAt,
			lastUsedAt
		})
		.run();
	return { id, userId, secret };
}

function bearer(secret: string, url = "https://uwu.land/api/v1/me"): Request {
	return new Request(url, {
		headers: { authorization: `Bearer ${secret}` }
	});
}

async function createJwt(
	userId = "user_jwt",
	iss = issuer,
	kid = "test-key-1"
): Promise<{
	jwt: string;
	jwks: TestJwks;
}> {
	const keyPair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256"
		},
		true,
		["sign", "verify"]
	)) as CryptoKeyPair;
	const publicJwk = (await crypto.subtle.exportKey(
		"jwk",
		keyPair.publicKey
	)) as JsonWebKey & { kid?: string; alg?: string; use?: string };
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", kid, typ: "JWT" };
	const payload = {
		aud: "uwu-land",
		exp: now + 300,
		iat: now,
		iss,
		nbf: now - 5,
		sub: userId
	};
	const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		keyPair.privateKey,
		new TextEncoder().encode(signingInput)
	);
	return {
		jwt: `${signingInput}.${base64Url(new Uint8Array(signature))}`,
		jwks: {
			keys: [
				{
					...publicJwk,
					alg: "RS256",
					kid,
					use: "sig"
				}
			]
		}
	};
}

function base64UrlJson(value: unknown): string {
	return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

describe("API key helpers", () => {
	it("generates uwu secrets, SHA-256 hashes, and display prefixes", async () => {
		const key = await generateApiKey();

		expect(key.secret).toMatch(/^uwu_[0-9A-Za-z]{32}$/);
		expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(key.displayPrefix).toBe(key.secret.slice(0, 12));
		expect(await hashKey(key.secret)).toBe(key.hash);
	});
});

describe("auth middleware", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
	});

	it("resolves absent authorization as anonymous", async () => {
		const ctx = createExecutionContext();

		const auth = await resolveAuth(
			new Request("https://uwu.land/api/v1/links"),
			env as Env,
			ctx
		);

		expect(auth).toEqual({ kind: "anon" });
	});

	it("resolves active API keys and stamps lastUsedAt at most hourly", async () => {
		const limitedUntil = new Date("2026-07-17T10:00:00.000Z");
		await seedUser("user_123", "pro", "email_hash_123", limitedUntil);
		const seeded = await seedApiKey({
			lastUsedAt: new Date("2026-07-10T08:00:00.000Z")
		});
		const ctx = createExecutionContext();
		const now = new Date("2026-07-10T10:00:00.000Z");

		const auth = await resolveAuth(bearer(seeded.secret), env as Env, ctx, {
			now: () => now
		});
		await waitOnExecutionContext(ctx);

		expect(auth).toEqual({
			emailHash: "email_hash_123",
			kind: "key",
			keyId: "key_123",
			limitedUntil,
			tier: "pro",
			userId: "user_123"
		});
		const db = drizzle(env.DB);
		const [afterFirstUse] = await db
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.id, "key_123"))
			.all();
		expect(afterFirstUse?.lastUsedAt).toEqual(now);

		const ctx2 = createExecutionContext();
		await resolveAuth(bearer(seeded.secret), env as Env, ctx2, {
			now: () => new Date("2026-07-10T10:30:00.000Z")
		});
		await waitOnExecutionContext(ctx2);

		const [afterSecondUse] = await db
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.id, "key_123"))
			.all();
		expect(afterSecondUse?.lastUsedAt).toEqual(now);
	});

	it("rejects revoked and wrong API keys with the error envelope", async () => {
		await seedUser();
		const revoked = await seedApiKey({
			id: "key_revoked",
			secret: "uwu_revoked00000000000000000000",
			revokedAt: new Date("2026-07-10T09:00:00.000Z")
		});
		const app = new Hono<{ Bindings: Env }>();
		app.use("/protected", authMiddleware());
		app.get("/protected", (c) => c.json({ ok: true }));

		const revokedResponse = await app.fetch(
			bearer(revoked.secret, "https://uwu.land/protected"),
			env as Env,
			createExecutionContext()
		);
		const wrongResponse = await app.fetch(
			bearer("uwu_missing00000000000000000000", "https://uwu.land/protected"),
			env as Env,
			createExecutionContext()
		);

		await expect(revokedResponse.json()).resolves.toMatchObject({
			code: "unauthorized",
			status: 401
		});
		expect(revokedResponse.status).toBe(401);
		await expect(wrongResponse.json()).resolves.toMatchObject({
			code: "unauthorized",
			status: 401
		});
		expect(wrongResponse.status).toBe(401);
	});

	it("verifies Clerk session JWTs against an injected JWKS and upserts users", async () => {
		const { jwt, jwks } = await createJwt("user_jwt");
		const ctx = createExecutionContext();

		const auth = await resolveAuth(bearer(jwt), env as Env, ctx, {
			clerkIssuer: issuer,
			jwks
		});

		expect(auth).toEqual({
			emailHash: null,
			kind: "session",
			limitedUntil: null,
			tier: "free",
			userId: "user_jwt"
		});
		expect(await drizzle(env.DB).select().from(users).all()).toMatchObject([
			{
				id: "user_jwt",
				tier: "free"
			}
		]);
	});

	it("fetches the issuer JWKS when none is injected", async () => {
		const iss = "https://fetch-once.clerk.test";
		const { jwt, jwks } = await createJwt("user_fetched", iss);
		const fetched: string[] = [];

		const auth = await resolveAuth(
			bearer(jwt),
			env as Env,
			createExecutionContext(),
			{
				clerkIssuer: iss,
				fetchJwks: async (url) => {
					fetched.push(url);
					return jwks;
				}
			}
		);

		expect(auth).toEqual({
			emailHash: null,
			kind: "session",
			limitedUntil: null,
			tier: "free",
			userId: "user_fetched"
		});
		expect(fetched).toEqual([`${iss}/.well-known/jwks.json`]);
	});

	it("caches the fetched JWKS across requests", async () => {
		const iss = "https://cache.clerk.test";
		const { jwt, jwks } = await createJwt("user_cached", iss);
		let fetchCount = 0;
		const options = {
			clerkIssuer: iss,
			fetchJwks: async () => {
				fetchCount++;
				return jwks;
			}
		};

		await resolveAuth(bearer(jwt), env as Env, createExecutionContext(), options);
		await resolveAuth(bearer(jwt), env as Env, createExecutionContext(), options);

		expect(fetchCount).toBe(1);
	});

	it("refetches the JWKS when the kid is unknown, then rejects if still missing", async () => {
		const iss = "https://rotate.clerk.test";
		const oldKey = await createJwt("user_old", iss, "kid-old");
		const newKey = await createJwt("user_new", iss, "kid-new");
		// The issuer serves the old key first, then rotates to the new key.
		const served = [oldKey.jwks, newKey.jwks, newKey.jwks];
		let fetchCount = 0;
		const options = {
			clerkIssuer: iss,
			fetchJwks: async () => {
				const next = served[fetchCount];
				fetchCount++;
				if (next === undefined) {
					throw new Error("unexpected extra fetch");
				}
				return next;
			}
		};

		// Primes the cache with the old JWKS.
		await resolveAuth(
			bearer(oldKey.jwt),
			env as Env,
			createExecutionContext(),
			options
		);
		expect(fetchCount).toBe(1);

		// New kid misses the cache, triggering one refetch that finds it.
		const auth = await resolveAuth(
			bearer(newKey.jwt),
			env as Env,
			createExecutionContext(),
			options
		);
		expect(auth).toMatchObject({ kind: "session", userId: "user_new" });
		expect(fetchCount).toBe(2);

		// A kid the issuer never serves fails after exactly one more refetch.
		const unknownKey = await createJwt("user_unknown", iss, "kid-never");
		await expect(
			resolveAuth(
				bearer(unknownKey.jwt),
				env as Env,
				createExecutionContext(),
				options
			)
		).rejects.toThrow("Unauthorized");
		expect(fetchCount).toBe(3);
	});

	it("rejects invalid Clerk session JWTs with the error envelope", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use(
			"/protected",
			authMiddleware({ clerkIssuer: issuer, jwks: { keys: [] } })
		);
		app.get("/protected", (c) => c.json({ ok: true }));

		const response = await app.fetch(
			bearer("not-a-jwt", "https://uwu.land/protected"),
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			code: "unauthorized",
			status: 401
		});
	});
});
