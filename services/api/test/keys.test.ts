import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { apiKeys, stripeCustomers, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import type { TestJwks } from "../src/auth";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import { createWorker } from "../src/worker";
import { resetD1 } from "./helpers/d1";

type TestFetch = (
	request: Request,
	env: Env,
	ctx: ExecutionContext
) => Promise<Response>;

const issuer = "https://clerk.test";

async function clearKv(namespace: KVNamespace): Promise<void> {
	const list = await namespace.list();
	await Promise.all(list.keys.map((key) => namespace.delete(key.name)));
}

async function createJwt(userId = "user_session"): Promise<{
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

function request(
	path: string,
	token: string,
	method = "GET",
	body?: unknown
): Request {
	const headers = new Headers({ authorization: `Bearer ${token}` });
	if (body !== undefined) {
		headers.set("content-type", "application/json");
	}
	return new Request(`https://uwu.land${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function sessionFetch(userId = "user_session"): Promise<{
	fetch: TestFetch;
	jwt: string;
}> {
	const { jwt, jwks } = await createJwt(userId);
	const worker = createWorker({ auth: { clerkIssuer: issuer, jwks } });
	return { fetch: worker.fetch as TestFetch, jwt };
}

async function seedApiKey(secret = "uwu_seeded000000000000000000000"): Promise<string> {
	const db = drizzle(env.DB);
	await db.insert(users).values({ id: "user_key", tier: "free" }).run();
	await db.insert(apiKeys)
		.values({
			id: "key_seeded",
			userId: "user_key",
			name: "Seeded",
			keyHash: await hashKey(secret),
			displayPrefix: secret.slice(0, 12)
		})
		.run();
	return secret;
}

describe("API key management", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
		await clearKv(env.UWU);
	});

	it("reports empty usage, active keys, and excludes revoked keys from /me", async () => {
		const { fetch, jwt } = await sessionFetch();

		const empty = await fetch(
			request("/api/v1/me", jwt),
			env as Env,
			createExecutionContext()
		);
		await expect(empty.json()).resolves.toMatchObject({
			usage: { createdToday: 0, apiKeys: 0, resetAt: null }
		});

		const created = await fetch(
			request("/api/v1/keys", jwt, "POST", { name: "Counted" }),
			env as Env,
			createExecutionContext()
		);
		const { id } = await created.json<{ id: string }>();

		const withKey = await fetch(
			request("/api/v1/me", jwt),
			env as Env,
			createExecutionContext()
		);
		await expect(withKey.json()).resolves.toMatchObject({
			usage: { apiKeys: 1 }
		});

		const revoked = await fetch(
			request(`/api/v1/keys/${id}`, jwt, "DELETE"),
			env as Env,
			createExecutionContext()
		);
		expect(revoked.status).toBe(204);

		const afterRevocation = await fetch(
			request("/api/v1/me", jwt),
			env as Env,
			createExecutionContext()
		);
		await expect(afterRevocation.json()).resolves.toMatchObject({
			usage: { apiKeys: 0 }
		});
	});

	it("reports link creations and a future daily-window reset from /me", async () => {
		const { fetch, jwt } = await sessionFetch();

		for (let index = 0; index < 3; index++) {
			const created = await fetch(
				request("/api/v1/links", jwt, "POST", {
					url: `https://example.com/usage-${index}`
				}),
				env as Env,
				createExecutionContext()
			);
			expect(created.status).toBe(201);
		}

		const response = await fetch(
			request("/api/v1/me", jwt),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{
			usage: { createdToday: number; resetAt: string | null };
		}>();

		expect(response.status).toBe(200);
		expect(body.usage.createdToday).toBe(3);
		expect(body.usage.resetAt).toEqual(expect.any(String));
		expect(new Date(body.usage.resetAt as string).getTime()).toBeGreaterThan(
			Date.now()
		);
	});

	it("reports billing history for sessions but not API-key principals", async () => {
		const db = drizzle(env.DB);
		await db.insert(stripeCustomers)
			.values({ userId: "user_session", customerId: "cus_history" })
			.run();
		const { fetch, jwt } = await sessionFetch();

		const sessionResponse = await fetch(
			request("/api/v1/me", jwt),
			env as Env,
			createExecutionContext()
		);
		await expect(sessionResponse.json()).resolves.toMatchObject({
			hasBillingHistory: true
		});

		const secret = await seedApiKey();
		await db.insert(stripeCustomers)
			.values({ userId: "user_key", customerId: "cus_key_history" })
			.run();
		const keyResponse = await fetch(
			request("/api/v1/me", secret),
			env as Env,
			createExecutionContext()
		);
		await expect(keyResponse.json()).resolves.toMatchObject({
			hasBillingHistory: false
		});
	});

	it("creates a key for a Clerk session and shows the secret only in the create response", async () => {
		const { fetch, jwt } = await sessionFetch();

		const response = await fetch(
			request("/api/v1/keys", jwt, "POST", { name: "Default" }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{
			id: string;
			name: string;
			secret: string;
			display_prefix: string;
		}>();

		expect(response.status).toBe(201);
		expect(body.id).toEqual(expect.any(String));
		expect(body.name).toBe("Default");
		expect(body.secret).toMatch(/^uwu_[0-9A-Za-z]{32}$/);
		expect(body.display_prefix).toBe(body.secret.slice(0, 12));

		const [stored] = await drizzle(env.DB).select().from(apiKeys).all();
		expect(stored).toMatchObject({
			id: body.id,
			userId: "user_session",
			name: "Default",
			keyHash: await hashKey(body.secret),
			displayPrefix: body.display_prefix,
			revokedAt: null
		});

		const list = await fetch(
			request("/api/v1/keys", jwt),
			env as Env,
			createExecutionContext()
		);
		const listBody = await list.json<{
			keys: Array<Record<string, unknown>>;
		}>();
		expect(list.status).toBe(200);
		expect(listBody.keys).toHaveLength(1);
		expect(listBody.keys[0]).toMatchObject({
			id: body.id,
			name: "Default",
			display_prefix: body.display_prefix
		});
		expect(listBody.keys[0]).not.toHaveProperty("secret");
		expect(listBody.keys[0]).not.toHaveProperty("key_hash");
	});

	it("atomically enforces the free tier non-revoked key limit", async () => {
		const { fetch, jwt } = await sessionFetch();

		const responses = await Promise.all(
			["First", "Second", "Third"].map((name) =>
				fetch(
					request("/api/v1/keys", jwt, "POST", { name }),
					env as Env,
					createExecutionContext()
				)
			)
		);
		const successes = responses.filter(({ status }) => status === 201);
		const rejected = responses.filter(({ status }) => status === 409);

		expect(successes).toHaveLength(2);
		expect(rejected).toHaveLength(1);
		await expect(rejected[0]?.json()).resolves.toMatchObject({ code: "key_limit" });
		const active = await drizzle(env.DB)
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.userId, "user_session"))
			.all();
		expect(active).toHaveLength(2);
	});

	it("frees quota when a key is revoked", async () => {
		const { fetch, jwt } = await sessionFetch();
		const created = await fetch(
			request("/api/v1/keys", jwt, "POST", { name: "First" }),
			env as Env,
			createExecutionContext()
		);
		const { id } = await created.json<{ id: string }>();

		const revoked = await fetch(
			request(`/api/v1/keys/${id}`, jwt, "DELETE"),
			env as Env,
			createExecutionContext()
		);
		const replacement = await fetch(
			request("/api/v1/keys", jwt, "POST", { name: "Replacement" }),
			env as Env,
			createExecutionContext()
		);

		expect(revoked.status).toBe(204);
		expect(replacement.status).toBe(201);
		const stored = await drizzle(env.DB)
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.userId, "user_session"))
			.all();
		expect(stored).toHaveLength(2);
		expect(stored.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(1);
	});

	it("leaves existing over-quota accounts unchanged", async () => {
		const { fetch, jwt } = await sessionFetch();
		const db = drizzle(env.DB);
		await db.insert(users).values({ id: "user_session", tier: "free" }).run();
		await db.insert(apiKeys).values([
			{
				id: "key_existing_1",
				userId: "user_session",
				name: "Existing 1",
				keyHash: "1".repeat(64),
				displayPrefix: "uwu_existing1"
			},
			{
				id: "key_existing_2",
				userId: "user_session",
				name: "Existing 2",
				keyHash: "2".repeat(64),
				displayPrefix: "uwu_existing2"
			}
		]).run();

		const response = await fetch(
			request("/api/v1/keys", jwt, "POST", { name: "Excess" }),
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({ code: "key_limit" });
		const stored = await db
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.userId, "user_session"))
			.all();
		expect(stored).toHaveLength(2);
		expect(stored.every(({ revokedAt }) => revokedAt === null)).toBe(true);
	});

	it("forbids API-key callers from managing keys", async () => {
		const secret = await seedApiKey();
		const { fetch } = await sessionFetch();

		const response = await fetch(
			request("/api/v1/keys", secret, "POST", { name: "Nope" }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(403);
		expect(body.code).toBe("forbidden");
	});

	it("revokes keys and revoked keys immediately fail auth", async () => {
		const { fetch, jwt } = await sessionFetch();
		const create = await fetch(
			request("/api/v1/keys", jwt, "POST", { name: "Revocable" }),
			env as Env,
			createExecutionContext()
		);
		const created = await create.json<{ id: string; secret: string }>();

		const deleteCtx = createExecutionContext();
		const deleted = await fetch(
			request(`/api/v1/keys/${created.id}`, jwt, "DELETE"),
			env as Env,
			deleteCtx
		);
		await waitOnExecutionContext(deleteCtx);

		expect(deleted.status).toBe(204);
		const [stored] = await drizzle(env.DB)
			.select()
			.from(apiKeys)
			.where(eq(apiKeys.id, created.id))
			.all();
		expect(stored?.revokedAt).toBeInstanceOf(Date);

		const revokedAuth = await fetch(
			request("/api/v1/me", created.secret),
			env as Env,
			createExecutionContext()
		);
		expect(revokedAuth.status).toBe(401);
	});
});
