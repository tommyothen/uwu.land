import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { apiKeys, links, users } from "@uwu/db/schema";
import { TIERS } from "@uwu/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { recordBannedAttempt } from "../src/abuse";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import worker, { createWorker } from "../src/worker";
import { resetD1 } from "./helpers/d1";

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

async function seedApiKeysForSameAccount(): Promise<{
	first: string;
	second: string;
}> {
	const first = "uwu_quota_first00000000000000000000";
	const second = "uwu_quota_second0000000000000000000";
	const db = drizzle(env.DB);
	await db.insert(users).values({ id: "user_quota", tier: "pro" }).run();
	await db
		.insert(apiKeys)
		.values([
			{
				id: "key_quota_first",
				userId: "user_quota",
				name: "First quota key",
				keyHash: await hashKey(first),
				displayPrefix: first.slice(0, 12)
			},
			{
				id: "key_quota_second",
				userId: "user_quota",
				name: "Second quota key",
				keyHash: await hashKey(second),
				displayPrefix: second.slice(0, 12)
			}
		])
		.run();
	return { first, second };
}

async function seedKeyForUser({
	userId,
	keyId,
	secret,
	emailHash = null,
	limitedUntil = null,
	tier = "pro"
}: {
	userId: string;
	keyId: string;
	secret: string;
	emailHash?: string | null;
	limitedUntil?: Date | null;
	tier?: "free" | "pro";
}): Promise<string> {
	const db = drizzle(env.DB);
	await db.insert(users).values({
		id: userId,
		tier,
		emailHash,
		limitedUntil
	}).run();
	await db.insert(apiKeys).values({
		id: keyId,
		userId,
		name: "Scope test",
		keyHash: await hashKey(secret),
		displayPrefix: secret.slice(0, 12)
	}).run();
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
		expect(
			await env.ENFORCEMENT.getByName("abuse:203.0.113.10").isBlocked()
		).toBe(false);
	});

	it("blocks IPs that have been auto-banned from creating links", async () => {
		const ip = "203.0.113.60";
		await Promise.all(
			Array.from({ length: 5 }, () => recordBannedAttempt(env.ENFORCEMENT, ip))
		);
		await env.UWU.put("banned:example.com", "1");

		const response = await workerFetch(
			createRequest({ url: "https://example.com/blocked" }, ip),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(403);
		expect(body.code).toBe("ip_blocked");
	});

	it("does not record normal creates as banned-destination abuse", async () => {
		const ip = "203.0.113.61";

		const response = await workerFetch(
			createRequest({ url: "https://example.com/normal" }, ip),
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(201);
		expect(
			await env.ENFORCEMENT.getByName(`abuse:${ip}`).isBlocked()
		).toBe(false);
	});

	it("blocks an IP after its fifth banned-destination attempt", async () => {
		const ip = "203.0.113.62";

		for (let index = 0; index < 4; index++) {
			await recordBannedAttempt(env.ENFORCEMENT, ip);
		}
		expect(
			await env.ENFORCEMENT.getByName(`abuse:${ip}`).isBlocked()
		).toBe(false);

		await recordBannedAttempt(env.ENFORCEMENT, ip);

		expect(
			await env.ENFORCEMENT.getByName(`abuse:${ip}`).isBlocked()
		).toBe(true);
	});

	it("does not count banned-destination attempts from authenticated callers", async () => {
		const secret = await seedApiKey();
		await env.UWU.put("banned:example.com", "1");
		const ip = "203.0.113.70";

		// Well past the anonymous threshold of 5, all from one shared IP (the
		// Discord-bot case). None of these may accrue an abuse strike.
		for (let index = 0; index < 6; index++) {
			const request = createRequest({ url: "https://example.com/x" }, ip);
			request.headers.set("authorization", `Bearer ${secret}`);
			const response = await workerFetch(
				request,
				env as Env,
				createExecutionContext()
			);
			const body = await response.json<{ code: string }>();
			expect(response.status).toBe(400);
			expect(body.code).toBe("url_banned");
		}

		expect(
			await env.ENFORCEMENT.getByName(`abuse:${ip}`).isBlocked()
		).toBe(false);
	});

	it("does not apply an existing IP block to authenticated callers", async () => {
		const secret = await seedApiKey();
		const ip = "203.0.113.71";
		await Promise.all(
			Array.from({ length: 5 }, () => recordBannedAttempt(env.ENFORCEMENT, ip))
		);
		expect(
			await env.ENFORCEMENT.getByName(`abuse:${ip}`).isBlocked()
		).toBe(true);

		const request = createRequest({ url: "https://not-banned.example/ok" }, ip);
		request.headers.set("authorization", `Bearer ${secret}`);
		const response = await workerFetch(
			request,
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(201);
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

	it("rejects URLs longer than 2048 characters", async () => {
		const response = await workerFetch(
			createRequest({ url: `https://example.com/${"a".repeat(2029)}` }),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(400);
		expect(body.code).toBe("invalid_body");
	});

	it("rejects URLs containing credentials", async () => {
		const response = await workerFetch(
			createRequest({ url: "https://user:pass@example.com" }),
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
		const body = await response.json<{
			code: string;
			retry_after: number;
		}>();

		expect(response.status).toBe(429);
		expect(body.code).toBe("rate_limited");
		expect(body.retry_after).toEqual(expect.any(Number));
		expect(body.retry_after).toBeGreaterThanOrEqual(1);
		expect(response.headers.get("Retry-After")).toBe(
			String(body.retry_after)
		);
	});

	it("allows exactly the create maximum under simultaneous requests", async () => {
		let nextId = 0;
		const quotaWorker = createWorker({
			createPerDayLimit: 3,
			generateId: () => `parallel-${nextId++}`
		});
		const quotaFetch = quotaWorker.fetch as TestFetch;
		const responses = await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				quotaFetch(
					createRequest(
						{ url: `https://example.com/parallel-${index}` },
						"203.0.113.32"
					),
					env as Env,
					createExecutionContext()
				)
			)
		);

		expect(responses.filter((response) => response.status === 201)).toHaveLength(
			3
		);
		expect(responses.filter((response) => response.status === 429)).toHaveLength(
			7
		);
	});

	it("shares an account daily quota across API keys", async () => {
		const keys = await seedApiKeysForSameAccount();
		const quotaWorker = createWorker({ createPerDayLimit: 1 });
		const quotaFetch = quotaWorker.fetch as TestFetch;

		const first = await quotaFetch(
			createAuthedRequest({ url: "https://example.com/quota-first" }, keys.first),
			env as Env,
			createExecutionContext()
		);
		const second = await quotaFetch(
			createAuthedRequest(
				{ url: "https://example.com/quota-second" },
				keys.second
			),
			env as Env,
			createExecutionContext()
		);

		expect(first.status).toBe(201);
		expect(second.status).toBe(429);
	});

	it("shares an identity quota across user ids when email hashes match", async () => {
		const first = await seedKeyForUser({
			userId: "user_identity_first",
			keyId: "key_identity_first",
			secret: "uwu_identity_first00000000000000000",
			emailHash: "shared_identity_hash"
		});
		const second = await seedKeyForUser({
			userId: "user_identity_second",
			keyId: "key_identity_second",
			secret: "uwu_identity_second0000000000000000",
			emailHash: "shared_identity_hash"
		});
		const quotaFetch = createWorker({ createPerDayLimit: 1 }).fetch as TestFetch;

		const firstResponse = await quotaFetch(
			createAuthedRequest({ url: "https://example.com/identity-first" }, first),
			env as Env,
			createExecutionContext()
		);
		const secondResponse = await quotaFetch(
			createAuthedRequest({ url: "https://example.com/identity-second" }, second),
			env as Env,
			createExecutionContext()
		);

		expect(firstResponse.status).toBe(201);
		expect(secondResponse.status).toBe(429);
	});

	it("keeps user-id quotas separate when email hashes are missing", async () => {
		const first = await seedKeyForUser({
			userId: "user_no_identity_first",
			keyId: "key_no_identity_first",
			secret: "uwu_no_identity_first000000000000000"
		});
		const second = await seedKeyForUser({
			userId: "user_no_identity_second",
			keyId: "key_no_identity_second",
			secret: "uwu_no_identity_second00000000000000"
		});
		const quotaFetch = createWorker({ createPerDayLimit: 1 }).fetch as TestFetch;

		const responses = await Promise.all([
			quotaFetch(
				createAuthedRequest({ url: "https://example.com/no-identity-first" }, first),
				env as Env,
				createExecutionContext()
			),
			quotaFetch(
				createAuthedRequest({ url: "https://example.com/no-identity-second" }, second),
				env as Env,
				createExecutionContext()
			)
		]);

		expect(responses.map(({ status }) => status)).toEqual([201, 201]);
	});

	it("enforces and reports the anonymous create limit for a limited user", async () => {
		const secret = await seedKeyForUser({
			userId: "user_limited",
			keyId: "key_limited",
			secret: "uwu_limited000000000000000000000000",
			emailHash: "limited_identity_hash",
			limitedUntil: new Date(Date.now() + 86_400_000)
		});

		for (let index = 0; index < TIERS.anon.createPerDay; index++) {
			const response = await workerFetch(
				createAuthedRequest(
					{ url: `https://example.com/limited-${index}` },
					secret
				),
				env as Env,
				createExecutionContext()
			);
			expect(response.status).toBe(201);
		}

		const overLimit = await workerFetch(
			createAuthedRequest({ url: "https://example.com/limited-over" }, secret),
			env as Env,
			createExecutionContext()
		);
		const usage = await workerFetch(
			new Request("https://uwu.land/api/v1/me", {
				headers: { authorization: `Bearer ${secret}` }
			}),
			env as Env,
			createExecutionContext()
		);
		const usageBody = await usage.json<{
			limits: { createPerDay: number };
		}>();

		expect(overLimit.status).toBe(429);
		expect(usage.status).toBe(200);
		expect(usageBody.limits.createPerDay).toBe(TIERS.anon.createPerDay);
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

	it("records an anonymous create in D1 for abuse visibility", async () => {
		const response = await workerFetch(
			createRequest({ url: "https://example.com/recorded" }, "203.0.113.47"),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ slug: string }>();
		const [row] = await drizzle(env.DB)
			.select()
			.from(links)
			.where(eq(links.slug, body.slug))
			.all();

		expect(row).toMatchObject({
			slug: body.slug,
			url: "https://example.com/recorded",
			ownerId: null,
			externalRef: null,
			source: "web-anon"
		});
	});

	it("does not add a second D1 row for an anonymous dedup hit", async () => {
		await workerFetch(
			createRequest({ url: "https://example.com/only-once" }, "203.0.113.48"),
			env as Env,
			createExecutionContext()
		);
		await workerFetch(
			createRequest({ url: "HTTPS://EXAMPLE.com/only-once#fragment" }, "203.0.113.49"),
			env as Env,
			createExecutionContext()
		);
		const rows = await drizzle(env.DB)
			.select()
			.from(links)
			.where(eq(links.url, "https://example.com/only-once"))
			.all();

		expect(rows).toHaveLength(1);
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

	it("republishes the D1-reserved anonymous link when its redirect is missing", async () => {
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

		expect(secondBody.slug).toBe(firstBody.slug);
		expect(await env.UWU.get(firstBody.slug)).toBe("https://example.com/stale");
		expect(
			await env.UWU.get(`urlmap:${await hashKey("https://example.com/stale")}`)
		).toBe(secondBody.slug);
	});
});
