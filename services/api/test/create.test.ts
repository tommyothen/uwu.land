import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
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

describe("anonymous link creation", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
		await clearKv(env.CLICKS);
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

	it("rate limits the 31st create from one IP in a day", async () => {
		for (let i = 0; i < 30; i++) {
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
});
