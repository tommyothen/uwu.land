import { env } from "cloudflare:test";
import { links } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileLink } from "../src/link-reconciliation";
import type { Env } from "../src/worker";
import { resetD1 } from "./helpers/d1";

function failMutation(namespace: KVNamespace, failure: { at: number; count: number }): KVNamespace {
	return new Proxy(namespace, {
		get(target, property) {
			if (property === "put" || property === "delete") {
				return async (...args: unknown[]) => {
					failure.count++;
					if (failure.count === failure.at) throw new Error(`injected KV failure ${failure.at}`);
					return Reflect.apply(Reflect.get(target, property), target, args);
				};
			}
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		}
	}) as KVNamespace;
}

async function row(slug: string) {
	const result = await drizzle(env.DB).select().from(links).where(eq(links.slug, slug)).get();
	if (result === undefined) throw new Error(`Missing test link: ${slug}`);
	return result;
}

describe("link reconciliation", () => {
	beforeEach(async () => resetD1(env.DB));

	it("does not publish a stale pending row after deletion", async () => {
		await drizzle(env.DB).insert(links).values({ slug: "stale", url: "https://example.com", source: "web-anon", lifecycleState: "pending_publish" }).run();
		const pending = await row("stale");
		await drizzle(env.DB).update(links).set({ lifecycleState: "pending_delete" }).where(eq(links.slug, pending.slug)).run();
		await reconcileLink(env as Env, pending);
		expect(await env.UWU.get(pending.slug)).toBeNull();
		await reconcileLink(env as Env, await row(pending.slug));
		await reconcileLink(env as Env, pending);
		expect(await env.UWU.get(pending.slug)).toBeNull();
	});

	it("does not clean up KV from a stale deletion snapshot", async () => {
		await drizzle(env.DB).insert(links).values({ slug: "stale-delete", url: "https://example.com", source: "web-anon", lifecycleState: "pending_delete" }).run();
		const pending = await row("stale-delete");
		await drizzle(env.DB).update(links).set({ lifecycleState: "active" }).where(eq(links.slug, pending.slug)).run();
		await env.UWU.put(pending.slug, pending.url);
		await reconcileLink(env as Env, pending);
		expect(await env.UWU.get(pending.slug)).toBe(pending.url);
		expect((await row(pending.slug)).lifecycleState).toBe("active");
	});

	it("cleans up publication when deletion wins during a KV write", async () => {
		await drizzle(env.DB).insert(links).values({ slug: "racing", url: "https://example.com", source: "web-anon", lifecycleState: "pending_publish", urlHash: "racing-hash" }).run();
		const pending = await row("racing");
		const put = env.UWU.put.bind(env.UWU);
		const spy = vi.spyOn(env.UWU, "put").mockImplementationOnce(async (...args) => {
			await drizzle(env.DB).update(links).set({ lifecycleState: "pending_delete" }).where(eq(links.slug, pending.slug)).run();
			await reconcileLink(env as Env, await row(pending.slug));
			await put(...args);
		});
		try {
			await reconcileLink(env as Env, pending);
			expect(await env.UWU.get(pending.slug)).toBeNull();
			expect(await env.UWU.get("urlmap:racing-hash")).toBeNull();
			expect(await drizzle(env.DB).select().from(links).where(eq(links.slug, pending.slug)).get()).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});

	// Publication makes two KV mutations: the slug and the urlmap entry.
	for (const boundary of [1, 2]) {
		it(`replays publication after KV mutation ${boundary} fails`, async () => {
			await drizzle(env.DB).insert(links).values({ slug: `pub-${boundary}`, url: "https://example.com/pub", ownerId: null, externalRef: null, source: "web-anon", lifecycleState: "pending_publish", urlHash: `hash-${boundary}` }).run();
			const pending = await row(`pub-${boundary}`);
			const failure = { at: boundary, count: 0 };
			await expect(reconcileLink({ DB: env.DB, UWU: failMutation(env.UWU, failure), CLICKS: failMutation(env.CLICKS, failure) }, pending)).rejects.toThrow("injected KV failure");
			await reconcileLink(env as Env, await row(pending.slug));
			expect((await row(pending.slug)).lifecycleState).toBe("active");
			expect(await env.UWU.get(pending.slug)).toBe(pending.url);
			expect(await env.CLICKS.get(pending.slug)).toBeNull();
			expect(await env.UWU.get(`urlmap:${pending.urlHash}`)).toBe(pending.slug);
		});
	}

	for (const boundary of [1, 2, 3]) {
		it(`replays deletion after KV mutation ${boundary} fails`, async () => {
			const slug = `del-${boundary}`;
			await drizzle(env.DB).insert(links).values({ slug, url: "https://example.com/del", ownerId: null, externalRef: null, source: "web-anon", lifecycleState: "pending_delete", urlHash: `del-hash-${boundary}` }).run();
			await env.UWU.put(slug, "https://example.com/del");
			await env.CLICKS.put(slug, "4");
			await env.UWU.put(`urlmap:del-hash-${boundary}`, slug);
			const failure = { at: boundary, count: 0 };
			await expect(reconcileLink({ DB: env.DB, UWU: failMutation(env.UWU, failure), CLICKS: failMutation(env.CLICKS, failure) }, await row(slug))).rejects.toThrow("injected KV failure");
			expect((await row(slug)).lifecycleState).toBe("pending_delete");
			await reconcileLink(env as Env, await row(slug));
			expect(await drizzle(env.DB).select().from(links).where(eq(links.slug, slug)).get()).toBeUndefined();
			expect(await env.UWU.get(slug)).toBeNull();
			expect(await env.CLICKS.get(slug)).toBeNull();
		});
	}
});
