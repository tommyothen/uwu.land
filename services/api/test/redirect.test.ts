import {
	createExecutionContext,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/worker";
import worker from "../src/worker";

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

describe("redirects", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
		await clearKv(env.CLICKS);
	});

	it("redirects hits to the stored URL and increments clicks", async () => {
		await env.UWU.put("abcde", "https://example.com/a");
		await env.CLICKS.put("abcde", "1");
		const ctx = createExecutionContext();

		const response = await workerFetch(
			new Request("https://uwu.land/abcde", {
				headers: { Referer: "https://ref.example/path" }
			}),
			env as Env,
			ctx
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://example.com/a");
		await waitOnExecutionContext(ctx);
		expect(await env.CLICKS.get("abcde")).toBe("2");
	});

	it("redirects misses to the app 404 page", async () => {
		const response = await workerFetch(
			new Request("https://uwu.land/missing"),
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://app.uwu.land/404");
	});

	it("never treats bookkeeping keys as slugs", async () => {
		await env.UWU.put("ratelimit:anon:1.2.3.4", JSON.stringify({ count: 3, resetAt: 1 }));

		const response = await workerFetch(
			new Request("https://uwu.land/ratelimit%3Aanon%3A1.2.3.4"),
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://app.uwu.land/404");
	});

	it("does not treat API paths as slugs", async () => {
		await env.UWU.put("api", "https://example.com/wrong");
		const response = await workerFetch(
			new Request("https://uwu.land/api/nope"),
			env as Env,
			createExecutionContext()
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("location")).toBeNull();
	});
});

