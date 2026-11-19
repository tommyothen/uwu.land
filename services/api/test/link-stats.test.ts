import { createExecutionContext, env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, expect, it } from "vitest";
import { linkStats } from "../src/links";
import type { Env } from "../src/worker";
import { resetD1 } from "./helpers/d1";

// Stats read the click counter, which seeds itself from D1.
beforeAll(() => resetD1(env.DB));

it("limits public stats, including missing slugs, to 60 requests per IP", async () => {
	const app = new Hono<{ Bindings: Env }>().get("/stats/:slug", linkStats);
	await env.UWU.put("stats-test", "https://example.com");
	const request = (ip: string, slug = "stats-test") => app.fetch(new Request(`https://uwu.land/stats/${slug}`, {
		cf: {}, headers: { "CF-Connecting-IP": ip }
	}), env as Env, createExecutionContext());
	for (let i = 0; i < 60; i++) {
		expect((await request("192.0.2.60", i % 2 ? "missing" : "stats-test")).status).toBe(i % 2 ? 404 : 200);
	}
	const denied = await request("192.0.2.60");
	expect(denied.status).toBe(429);
	expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
	expect((await request("192.0.2.61")).status).toBe(200);
});

it("shares the stats quota across spoofed direct-request IPs", async () => {
	const app = new Hono<{ Bindings: Env }>().get("/stats/:slug", linkStats);
	for (let i = 0; i < 61; i++) {
		const response = await app.fetch(new Request("https://uwu.land/stats/missing", {
			headers: { "CF-Connecting-IP": `192.0.2.${i}` }
		}), env as Env, createExecutionContext());
		expect(response.status).toBe(i < 60 ? 404 : 429);
	}
});

it("reports the live counter total, including hits not yet flushed to D1", async () => {
	const app = new Hono<{ Bindings: Env }>().get("/stats/:slug", linkStats);
	await env.UWU.put("stats-live", "https://example.com");
	await env.CLICKS.put("stats-live", "4");
	await env.CLICK_COUNTER.getByName("stats-live").increment("stats-live");
	const response = await app.fetch(new Request("https://uwu.land/stats/stats-live", {
		cf: {}, headers: { "CF-Connecting-IP": "192.0.2.200" }
	}), env as Env, createExecutionContext());
	await expect(response.json()).resolves.toEqual({ slug: "stats-live", clicks: 5 });
});
