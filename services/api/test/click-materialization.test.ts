import { env } from "cloudflare:test";
import { links, users } from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { drainLegacyClickCounters } from "../src/click-materialization";
import { resetD1 } from "./helpers/d1";

async function clearClicks(): Promise<void> {
	const page = await env.CLICKS.list();
	await Promise.all(page.keys.map(({ name }) => env.CLICKS.delete(name)));
}

async function seedLink(slug: string, clicks = 0): Promise<void> {
	await drizzle(env.DB)
		.insert(links)
		.values({
			slug,
			url: `https://example.com/${slug}`,
			ownerId: "owner",
			source: "api",
			clicks
		})
		.run();
}

describe("legacy click drain", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
		await clearClicks();
		await drizzle(env.DB).insert(users).values({ id: "owner" }).run();
	});

	it("copies legacy totals into D1 without lowering newer ones, then deletes the keys", async () => {
		await seedLink("stale");
		await seedLink("ahead", 20);
		await seedLink("untouched", 3);
		await env.CLICKS.put("stale", "9");
		await env.CLICKS.put("ahead", "12");
		await env.CLICKS.put("deleted", "5");

		await drainLegacyClickCounters(env);

		await expect(drizzle(env.DB).select().from(links).orderBy(links.slug).all()).resolves.toMatchObject([
			{ slug: "ahead", clicks: 20 },
			{ slug: "stale", clicks: 9 },
			{ slug: "untouched", clicks: 3 }
		]);
		expect((await env.CLICKS.list()).keys).toEqual([]);
	});
});
