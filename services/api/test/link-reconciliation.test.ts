import { env } from "cloudflare:test";
import { links } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
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

	for (const boundary of [1, 2, 3]) {
		it(`replays publication after KV mutation ${boundary} fails`, async () => {
			await drizzle(env.DB).insert(links).values({ slug: `pub-${boundary}`, url: "https://example.com/pub", ownerId: null, externalRef: null, source: "web-anon", lifecycleState: "pending_publish", urlHash: `hash-${boundary}` }).run();
			const pending = await row(`pub-${boundary}`);
			const failure = { at: boundary, count: 0 };
			await expect(reconcileLink({ DB: env.DB, UWU: failMutation(env.UWU, failure), CLICKS: failMutation(env.CLICKS, failure) }, pending)).rejects.toThrow("injected KV failure");
			await reconcileLink(env as Env, await row(pending.slug));
			expect((await row(pending.slug)).lifecycleState).toBe("active");
			expect(await env.UWU.get(pending.slug)).toBe(pending.url);
			expect(await env.CLICKS.get(pending.slug)).toBe("0");
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
