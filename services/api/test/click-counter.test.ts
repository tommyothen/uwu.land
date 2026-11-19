import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { links, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { resetD1 } from "./helpers/d1";

const db = drizzle(env.DB);

async function seedLink(slug: string, clicks = 0): Promise<void> {
	await db.insert(links).values({ slug, url: `https://example.com/${slug}`, ownerId: "owner", source: "api", clicks }).run();
}

async function storedClicks(slug: string): Promise<number | undefined> {
	return (await db.select().from(links).where(eq(links.slug, slug)).get())?.clicks;
}

async function storageKeys(slug: string): Promise<string[]> {
	return runInDurableObject(env.CLICK_COUNTER.getByName(slug), async (_, state) =>
		[...state.storage.kv.list()].map(([key]) => key)
	);
}

describe("ClickCounter", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
		await db.insert(users).values({ id: "owner" }).run();
	});

	it("flushes the exact total to D1 on its alarm and then drops its state", async () => {
		await seedLink("flush", 7);
		await env.CLICKS.put("flush", "9");
		const counter = env.CLICK_COUNTER.getByName("flush");
		await Promise.all(Array.from({ length: 5 }, () => counter.increment("flush")));
		expect(await counter.clicks("flush")).toBe(14);

		expect(await runDurableObjectAlarm(counter)).toBe(true);
		expect(await storedClicks("flush")).toBe(14);
		expect(await storageKeys("flush")).toEqual([]);

		// Once the drain has removed the legacy key, D1 alone carries the total.
		await env.CLICKS.delete("flush");
		await counter.increment("flush");
		expect(await runDurableObjectAlarm(counter)).toBe(true);
		expect(await storedClicks("flush")).toBe(15);
	});

	it("drops state for a link that no longer exists", async () => {
		const counter = env.CLICK_COUNTER.getByName("gone");
		await counter.increment("gone");
		expect(await runDurableObjectAlarm(counter)).toBe(true);
		expect(await storageKeys("gone")).toEqual([]);
	});
});
