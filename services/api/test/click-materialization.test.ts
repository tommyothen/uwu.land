import { env } from "cloudflare:test";
import { links, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { materializeClickCounts } from "../src/click-materialization";
import { resetD1 } from "./helpers/d1";

async function clearClicks(): Promise<void> {
	const page = await env.CLICKS.list();
	await Promise.all(page.keys.map(({ name }) => env.CLICKS.delete(name)));
}

async function seedLink(slug: string): Promise<void> {
	await drizzle(env.DB)
		.insert(links)
		.values({
			slug,
			url: `https://example.com/${slug}`,
			ownerId: "owner",
			source: "api"
		})
		.run();
}

describe("click materialization", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
		await clearClicks();
		await drizzle(env.DB).insert(users).values({ id: "owner" }).run();
	});

	it("snapshots absolute totals and leaves new links at zero", async () => {
		await seedLink("clicked");
		await seedLink("new-zero");
		await env.CLICKS.put("clicked", "9");

		await materializeClickCounts(env);

		await expect(drizzle(env.DB).select().from(links).orderBy(links.slug).all()).resolves.toMatchObject([
			{ slug: "clicked", clicks: 9 },
			{ slug: "new-zero", clicks: 0 }
		]);
	});

	it("is idempotent on retry and ignores counters for deleted links", async () => {
		await seedLink("retry");
		await seedLink("deleted");
		await env.CLICKS.put("retry", "4");
		await env.CLICKS.put("deleted", "12");
		await drizzle(env.DB).delete(links).where(eq(links.slug, "deleted")).run();

		await materializeClickCounts(env);
		await materializeClickCounts(env);

		await expect(drizzle(env.DB).select().from(links).all()).resolves.toMatchObject([
			{ slug: "retry", clicks: 4 }
		]);
	});
});
