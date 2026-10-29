import { env, runInDurableObject } from "cloudflare:test";
import { links } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as reconciliation from "../src/link-reconciliation";
import { reconcileLink, reconcileLinkState } from "../src/link-reconciliation";
import type { Env } from "../src/worker";
import { resetD1 } from "./helpers/d1";

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function failMutation(namespace: KVNamespace, failure: { at: number; count: number }, beforeFailure: () => Promise<void>): KVNamespace {
	return new Proxy(namespace, {
		get(target, property) {
			if (property === "put" || property === "delete") {
				return async (...args: unknown[]) => {
					failure.count++;
					if (failure.count === failure.at) {
						await beforeFailure();
						throw new Error(`injected KV failure ${failure.at}`);
					}
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

	it("keeps deletion reserved until an in-flight publication is cleaned up", async () => {
		await drizzle(env.DB).insert(links).values({ slug: "racing", url: "https://example.com", source: "web-anon", lifecycleState: "pending_publish", urlHash: "racing-hash" }).run();
		const put = env.UWU.put.bind(env.UWU);
		const spy = vi.spyOn(env.UWU, "put").mockImplementationOnce(async (...args) => {
			expect((await row("racing")).lifecycleState).toBe("pending_publish");
			await drizzle(env.DB).update(links).set({ lifecycleState: "pending_delete" }).where(eq(links.slug, "racing")).run();
			await put(...args);
		});
		try {
			await reconcileLinkState(env, "racing");
			expect(await env.UWU.get("racing")).toBeNull();
			expect(await env.UWU.get("urlmap:racing-hash")).toBeNull();
			expect(await drizzle(env.DB).select().from(links).where(eq(links.slug, "racing")).get()).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});

	it("reads the replacement row instead of publishing a stale snapshot", async () => {
		await drizzle(env.DB).insert(links).values({ slug: "reused", url: "https://old.example/", source: "web-anon", lifecycleState: "pending_delete" }).run();
		const stale = { ...await row("reused"), lifecycleState: "pending_publish" as const };
		await reconcileLink(env, await row("reused"));
		await drizzle(env.DB).insert(links).values({ slug: "reused", url: "https://new.example/", source: "web-anon", lifecycleState: "pending_publish" }).run();
		await reconcileLink(env, stale);
		expect(await env.UWU.get("reused")).toBe("https://new.example/");
	});

	it("serialises overlapping reconciliations and continues after a failure", async () => {
		const stub = env.ENFORCEMENT.getByName("link:queue-test");
		await runInDurableObject(stub, async (instance) => {
			const entered = barrier();
			const release = barrier();
			const spy = vi.spyOn(reconciliation, "reconcileLinkState")
				.mockImplementationOnce(async () => {
					entered.resolve();
					await release.promise;
					throw new Error("interrupted publication");
				})
				.mockResolvedValueOnce();
			const first = expect(instance.reconcileLink("queue-test")).rejects.toThrow("interrupted publication");
			await entered.promise;
			const second = instance.reconcileLink("queue-test");
			try {
				await Promise.resolve();
				expect(spy).toHaveBeenCalledTimes(1);
			} finally {
				release.resolve();
				await Promise.all([first, second]);
				spy.mockRestore();
			}
		});
	});

	// Publication makes two KV mutations: the slug and the urlmap entry.
	for (const boundary of [1, 2]) {
		it(`replays publication after KV mutation ${boundary} fails`, async () => {
			await drizzle(env.DB).insert(links).values({ slug: `pub-${boundary}`, url: "https://example.com/pub", ownerId: null, externalRef: null, source: "web-anon", lifecycleState: "pending_publish", urlHash: `hash-${boundary}` }).run();
			const pending = await row(`pub-${boundary}`);
			const failure = { at: boundary, count: 0 };
			const beforeFailure = async () => {
				expect((await row(pending.slug)).lifecycleState).toBe("pending_publish");
			};
			await expect(reconcileLinkState({ DB: env.DB, UWU: failMutation(env.UWU, failure, beforeFailure), CLICKS: failMutation(env.CLICKS, failure, beforeFailure) }, pending.slug)).rejects.toThrow("injected KV failure");
			await reconcileLink(env as Env, pending);
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
			const beforeFailure = async () => {
				expect((await row(slug)).lifecycleState).toBe("pending_delete");
			};
			await expect(reconcileLinkState({ DB: env.DB, UWU: failMutation(env.UWU, failure, beforeFailure), CLICKS: failMutation(env.CLICKS, failure, beforeFailure) }, slug)).rejects.toThrow("injected KV failure");
			expect((await row(slug)).lifecycleState).toBe("pending_delete");
			await reconcileLink(env as Env, await row(slug));
			expect(await drizzle(env.DB).select().from(links).where(eq(links.slug, slug)).get()).toBeUndefined();
			expect(await env.UWU.get(slug)).toBeNull();
			expect(await env.CLICKS.get(slug)).toBeNull();
		});
	}
});
