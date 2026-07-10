import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { apiKeys, users } from "@uwu/db/schema";
import { TIERS } from "@uwu/shared";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import worker, { createWorker } from "../src/worker";

type TestFetch = (
	request: Request,
	env: Env,
	ctx: ExecutionContext
) => Promise<Response>;

const workerFetch = worker.fetch as TestFetch;

async function clearKv(namespace: KVNamespace): Promise<void> {
	const list = await namespace.list();
	await Promise.all(list.keys.map((key) => namespace.delete(key.name)));
}

function createRequest(body: unknown, ip = "203.0.113.10"): Request {
	return new Request("https://uwu.land/api/v1/links", {
		method: "POST",
		headers: {
			"CF-Connecting-IP": ip,
			"content-type": "application/json"
		},
		body: JSON.stringify(body)
	});
}

function createAuthedRequest(body: unknown, secret: string): Request {
	const request = createRequest(body);
	request.headers.set("authorization", `Bearer ${secret}`);
	return request;
}

async function resetD1(db: D1Database): Promise<void> {
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
				revoked_at integer
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
				created_at integer NOT NULL
			)`
		)
		.run();
	await db.batch([
		db.prepare("DELETE FROM api_keys"),
		db.prepare("DELETE FROM links"),
		db.prepare("DELETE FROM users")
	]);
}

async function seedApiKey(): Promise<string> {
	const secret = "uwu_create000000000000000000000000";
	const db = drizzle(env.DB);
	await db.insert(users).values({ id: "user_create", tier: "free" }).run();
	await db
		.insert(apiKeys)
		.values({
			id: "key_create",
			userId: "user_create",
			name: "Create test",
			keyHash: await hashKey(secret),
			displayPrefix: secret.slice(0, 12)
		})
		.run();
	return secret;
}

describe("anonymous link creation", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
		await clearKv(env.CLICKS);
		await resetD1(env.DB);
	});

	it("creates a random slug and the created slug redirects", async () => {
		const response = await workerFetch(
			createRequest({ url: "https://example.com/ok" }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ slug: string; short_url: string; url: string }>();

		expect(response.status).toBe(201);
		expect(body.url).toBe("https://example.com/ok");
		expect(body.short_url).toBe(`https://uwu.land/${body.slug}`);
		expect(await env.CLICKS.get(body.slug)).toBe("0");

		const redirect = await workerFetch(
			new Request(body.short_url),
			env as Env,
			createExecutionContext()
		);
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get("location")).toBe("https://example.com/ok");
	});

	it("rejects anonymous custom slugs", async () => {
		const response = await workerFetch(
			createRequest({ url: "https://example.com/ok", slug: "custom" }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string; message: string }>();

		expect(response.status).toBe(403);
		expect(body.code).toBe("forbidden");
		expect(body.message).toBe("Custom slugs need an account. Coming soon.");
	});

	it("rejects banned domains", async () => {
		await env.UWU.put("banned:example.com", "1");

		const response = await workerFetch(
			createRequest({ url: "https://sub.example.com/path" }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(400);
		expect(body.code).toBe("url_banned");
	});

	it("rejects uwu.land URLs", async () => {
		const response = await workerFetch(
			createRequest({ url: "https://uwu.land/abc" }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(400);
		expect(body.code).toBe("invalid_body");
	});

	it("rate limits the create after the anon daily limit from one IP", async () => {
		for (let i = 0; i < TIERS.anon.createPerDay; i++) {
			const response = await workerFetch(
				createRequest({ url: `https://example.com/${i}` }, "203.0.113.31"),
				env as Env,
				createExecutionContext()
			);
			expect(response.status).toBe(201);
		}

		const response = await workerFetch(
			createRequest({ url: "https://example.com/over" }, "203.0.113.31"),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(429);
		expect(body.code).toBe("rate_limited");
	});

	it("retries generated slug collisions", async () => {
		await env.UWU.put("taken", "https://example.com/taken");
		const ids = ["taken", "fresh"];
		const collisionWorker = createWorker({
			generateId: () => ids.shift() ?? "spare"
		});
		const collisionFetch = collisionWorker.fetch as TestFetch;
		const ctx = createExecutionContext();

		const response = await collisionFetch(
			createRequest({ url: "https://example.com/new" }),
			env as Env,
			ctx
		);
		const body = await response.json<{ slug: string }>();

		expect(response.status).toBe(201);
		expect(body.slug).toBe("fresh");
		await waitOnExecutionContext(ctx);
		expect(await env.UWU.get("fresh")).toBe("https://example.com/new");
	});

	it("deduplicates anonymous creates on normalized URLs", async () => {
		const first = await workerFetch(
			createRequest({ url: "HTTPS://EXAMPLE.com/" }, "203.0.113.40"),
			env as Env,
			createExecutionContext()
		);
		const second = await workerFetch(
			createRequest({ url: "https://example.com" }, "203.0.113.41"),
			env as Env,
			createExecutionContext()
		);

		expect((await first.json<{ slug: string }>()).slug).toBe(
			(await second.json<{ slug: string }>()).slug
		);
	});

	it("keeps distinct anonymous URLs separate", async () => {
		const first = await workerFetch(
			createRequest({ url: "https://example.com/one" }, "203.0.113.42"),
			env as Env,
			createExecutionContext()
		);
		const second = await workerFetch(
			createRequest({ url: "https://example.com/two" }, "203.0.113.43"),
			env as Env,
			createExecutionContext()
		);

		expect((await first.json<{ slug: string }>()).slug).not.toBe(
			(await second.json<{ slug: string }>()).slug
		);
	});

	it("still mints a fresh link for an authenticated create", async () => {
		const anonymous = await workerFetch(
			createRequest({ url: "https://example.com/same" }, "203.0.113.44"),
			env as Env,
			createExecutionContext()
		);
		const secret = await seedApiKey();
		const authenticated = await workerFetch(
			createAuthedRequest({ url: "https://example.com/same" }, secret),
			env as Env,
			createExecutionContext()
		);

		expect((await authenticated.json<{ slug: string }>()).slug).not.toBe(
			(await anonymous.json<{ slug: string }>()).slug
		);
	});

	it("replaces stale anonymous URL mappings", async () => {
		const first = await workerFetch(
			createRequest({ url: "https://example.com/stale" }, "203.0.113.45"),
			env as Env,
			createExecutionContext()
		);
		const firstBody = await first.json<{ slug: string }>();
		await env.UWU.delete(firstBody.slug);

		const second = await workerFetch(
			createRequest({ url: "https://example.com/stale" }, "203.0.113.46"),
			env as Env,
			createExecutionContext()
		);
		const secondBody = await second.json<{ slug: string }>();

		expect(secondBody.slug).not.toBe(firstBody.slug);
		expect(
			await env.UWU.get(`urlmap:${await hashKey("https://example.com/stale")}`)
		).toBe(secondBody.slug);
	});
});
