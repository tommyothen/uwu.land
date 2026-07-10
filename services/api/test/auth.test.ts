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

type Tier = "free" | "pro";

const issuer = "https://clerk.test";

async function clearD1(db: D1Database): Promise<void> {
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS users (
				id text PRIMARY KEY NOT NULL,
				tier text DEFAULT 'free' NOT NULL,
				created_at integer NOT NULL
			)`
		)
		.run();
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS api_keys (
				id text PRIMARY KEY NOT NULL,
				user_id text NOT NULL,
				name text NOT NULL,
				key_hash text NOT NULL,
				display_prefix text NOT NULL,
				created_at integer NOT NULL,
				last_used_at integer,
				revoked_at integer,
				FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE no action
			)`
		)
		.run();
	await db
		.prepare(
			"CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique ON api_keys (key_hash)"
		)
		.run();
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS links (
				slug text PRIMARY KEY NOT NULL,
				url text NOT NULL,
				owner_id text,
				external_ref text,
				source text NOT NULL,
				created_at integer NOT NULL,
				FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE no action ON DELETE no action
			)`
		)
		.run();
	await db
		.prepare("CREATE INDEX IF NOT EXISTS links_owner_idx ON links (owner_id, external_ref)")
		.run();
	await db.batch([
		db.prepare("DELETE FROM api_keys"),
		db.prepare("DELETE FROM links"),
		db.prepare("DELETE FROM users")
	]);
}

async function seedUser(id = "user_123", tier: Tier = "free") {
	const db = drizzle(env.DB);
	await db.insert(users).values({ id, tier }).run();
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

async function createJwt(userId = "user_jwt"): Promise<{
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
	const kid = "test-key-1";
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
		iss: issuer,
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
		await clearD1(env.DB);
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
		await seedUser("user_123", "pro");
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
			kind: "key",
			keyId: "key_123",
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
			kind: "session",
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
