import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { apiKeys, links, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import worker from "../src/worker";
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

async function seedApiKey({
	userId = "user_owner",
	tier = "free",
	keyId = "key_owner",
	secret = "uwu_owner0000000000000000000000"
}: {
	userId?: string;
	tier?: "free" | "pro";
	keyId?: string;
	secret?: string;
} = {}): Promise<string> {
	const db = drizzle(env.DB);
	await db.insert(users).values({ id: userId, tier }).run();
	await db.insert(apiKeys)
		.values({
			id: keyId,
			userId,
			name: "Test key",
			keyHash: await hashKey(secret),
			displayPrefix: secret.slice(0, 12)
		})
		.run();
	return secret;
}

function jsonRequest(
	path: string,
	body: unknown,
	secret?: string,
	method = "POST"
): Request {
	const headers = new Headers({ "content-type": "application/json" });
	if (secret !== undefined) {
		headers.set("authorization", `Bearer ${secret}`);
	}
	return new Request(`https://uwu.land${path}`, {
		method,
		headers,
		body: JSON.stringify(body)
	});
}

function authedRequest(path: string, secret: string, method = "GET"): Request {
	return new Request(`https://uwu.land${path}`, {
		method,
		headers: { authorization: `Bearer ${secret}` }
	});
}

async function seedLink({
	slug,
	userId = "user_owner",
	url = `https://example.com/${slug}`,
	externalRef = null,
	createdAt,
	clicks = "0",
	source = "api"
}: {
	slug: string;
	userId?: string | null;
	url?: string;
	externalRef?: string | null;
	createdAt: Date;
	clicks?: string;
	source?: "web-anon" | "api" | "dashboard";
}) {
	await drizzle(env.DB)
		.insert(links)
		.values({
			slug,
			url,
			ownerId: userId,
			externalRef,
			source,
			createdAt
		})
		.run();
	await env.UWU.put(slug, url);
	await env.CLICKS.put(slug, clicks);
}

describe("owned links CRUD", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
		await clearKv(env.UWU);
		await clearKv(env.CLICKS);
	});

	it("creates an owned custom slug with external_ref and writes through to KV", async () => {
		const secret = await seedApiKey({ tier: "pro" });
		const ctx = createExecutionContext();

		const response = await workerFetch(
			jsonRequest(
				"/api/v1/links",
				{
					url: "https://example.com/owned",
					slug: "mine",
					external_ref: "discord:42"
				},
				secret
			),
			env as Env,
			ctx
		);
		await waitOnExecutionContext(ctx);
		const body = await response.json<{
			slug: string;
			short_url: string;
			url: string;
		}>();

		expect(response.status).toBe(201);
		expect(body).toEqual({
			slug: "mine",
			short_url: "https://uwu.land/mine",
			url: "https://example.com/owned"
		});
		expect(await env.UWU.get("mine")).toBe("https://example.com/owned");
		expect(await env.CLICKS.get("mine")).toBe("0");
		expect(await drizzle(env.DB).select().from(links).all()).toMatchObject([
			{
				slug: "mine",
				ownerId: "user_owner",
				externalRef: "discord:42",
				source: "api"
			}
		]);
	});

	it("rejects custom slugs that already exist only in pre-v2 KV", async () => {
		const secret = await seedApiKey();
		await env.UWU.put("legacy", "https://example.com/legacy");

		const response = await workerFetch(
			jsonRequest(
				"/api/v1/links",
				{ url: "https://example.com/new", slug: "legacy" },
				secret
			),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{ code: string }>();

		expect(response.status).toBe(409);
		expect(body.code).toBe("slug_taken");
		expect(await drizzle(env.DB).select().from(links).all()).toHaveLength(0);
	});

	it("lists owned links newest first with external_ref filtering, clicks, and cursors", async () => {
		const secret = await seedApiKey();
		await seedLink({
			slug: "match-old",
			externalRef: "discord:42",
			createdAt: new Date("2026-07-10T09:00:00.000Z"),
			clicks: "3"
		});
		await seedLink({
			slug: "skip-ref",
			externalRef: "discord:99",
			createdAt: new Date("2026-07-10T10:00:00.000Z"),
			clicks: "4"
		});
		await seedLink({
			slug: "match-new",
			externalRef: "discord:42",
			createdAt: new Date("2026-07-10T11:00:00.000Z"),
			clicks: "7"
		});
		for (let i = 0; i < 26; i++) {
			await seedLink({
				slug: `page-${i.toString().padStart(2, "0")}`,
				createdAt: new Date(Date.UTC(2026, 6, 10, 12, i)),
				clicks: String(i)
			});
		}

		const filtered = await workerFetch(
			authedRequest("/api/v1/links?external_ref=discord%3A42", secret),
			env as Env,
			createExecutionContext()
		);
		const filteredBody = await filtered.json<{
			links: Array<{ slug: string; clicks: number; external_ref?: string }>;
		}>();

		expect(filtered.status).toBe(200);
		expect(filteredBody.links).toMatchObject([
			{ slug: "match-new", clicks: 7, external_ref: "discord:42" },
			{ slug: "match-old", clicks: 3, external_ref: "discord:42" }
		]);

		const firstPage = await workerFetch(
			authedRequest("/api/v1/links", secret),
			env as Env,
			createExecutionContext()
		);
		const firstPageBody = await firstPage.json<{
			links: Array<{ slug: string }>;
			cursor?: string;
		}>();
		expect(firstPageBody.links).toHaveLength(25);
		expect(firstPageBody.links[0]?.slug).toBe("page-25");
		expect(firstPageBody.cursor).toEqual(expect.any(String));

		const secondPage = await workerFetch(
			authedRequest(`/api/v1/links?cursor=${firstPageBody.cursor}`, secret),
			env as Env,
			createExecutionContext()
		);
		const secondPageBody = await secondPage.json<{
			links: Array<{ slug: string }>;
			cursor?: string;
		}>();
		expect(secondPageBody.links.map((link) => link.slug)).toContain("match-new");
		expect(secondPageBody.cursor).toBeUndefined();
	});

	it("gets owned link detail and rejects wrong owners", async () => {
		const ownerSecret = await seedApiKey();
		const otherSecret = await seedApiKey({
			userId: "user_other",
			keyId: "key_other",
			secret: "uwu_other0000000000000000000000"
		});
		await seedLink({
			slug: "owned",
			createdAt: new Date("2026-07-10T09:00:00.000Z"),
			clicks: "12"
		});

		const ownResponse = await workerFetch(
			authedRequest("/api/v1/links/owned", ownerSecret),
			env as Env,
			createExecutionContext()
		);
		const ownBody = await ownResponse.json<{ slug: string; clicks: number }>();
		expect(ownResponse.status).toBe(200);
		expect(ownBody).toMatchObject({ slug: "owned", clicks: 12 });

		const wrongOwner = await workerFetch(
			authedRequest("/api/v1/links/owned", otherSecret),
			env as Env,
			createExecutionContext()
		);
		expect(wrongOwner.status).toBe(403);
		await expect(wrongOwner.json()).resolves.toMatchObject({
			code: "forbidden"
		});
	});

	it("deletes owned links from D1 and KV but rejects anonymous links", async () => {
		const secret = await seedApiKey();
		await seedLink({
			slug: "owned",
			createdAt: new Date("2026-07-10T09:00:00.000Z"),
			clicks: "2"
		});
		await seedLink({
			slug: "anon",
			userId: null,
			source: "web-anon",
			createdAt: new Date("2026-07-10T10:00:00.000Z")
		});

		const anonDelete = await workerFetch(
			authedRequest("/api/v1/links/anon", secret, "DELETE"),
			env as Env,
			createExecutionContext()
		);
		expect(anonDelete.status).toBe(403);

		const ownedDelete = await workerFetch(
			authedRequest("/api/v1/links/owned", secret, "DELETE"),
			env as Env,
			createExecutionContext()
		);
		expect(ownedDelete.status).toBe(204);
		expect(await env.UWU.get("owned")).toBeNull();
		expect(await env.CLICKS.get("owned")).toBeNull();
		expect(
			await drizzle(env.DB).select().from(links).where(eq(links.slug, "owned")).all()
		).toHaveLength(0);
	});

	it("returns the authenticated user tier and limits from /me", async () => {
		const secret = await seedApiKey({ tier: "pro" });

		const response = await workerFetch(
			authedRequest("/api/v1/me", secret),
			env as Env,
			createExecutionContext()
		);
		const body = await response.json<{
			user_id: string;
			tier: string;
			limits: { createPerDay: number; apiKeys: number };
		}>();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			user_id: "user_owner",
			tier: "pro",
			limits: {
				createPerDay: 2000,
				apiKeys: 10
			}
		});
	});
});
