import { createExecutionContext, env } from "cloudflare:test";
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
const secret = "uwu_suspended0000000000000000000000";

function create(url: string): Promise<Response> {
	return workerFetch(
		new Request("https://uwu.land/api/v1/links", {
			method: "POST",
			headers: {
				authorization: `Bearer ${secret}`,
				"CF-Connecting-IP": "203.0.113.40",
				"content-type": "application/json"
			},
			body: JSON.stringify({ url })
		}),
		env as Env,
		createExecutionContext()
	);
}

describe("account suspension", () => {
	beforeEach(async () => {
		await resetD1(env.DB);
		const db = drizzle(env.DB);
		await db
			.insert(users)
			.values({ id: "user_suspended", tier: "pro", suspendedAt: new Date() })
			.run();
		await db
			.insert(apiKeys)
			.values({
				id: "key_suspended",
				userId: "user_suspended",
				name: "Suspended",
				keyHash: await hashKey(secret),
				displayPrefix: secret.slice(0, 12)
			})
			.run();
	});

	it("refuses creates while suspended and allows them again once lifted", async () => {
		const refused = await create("https://example.com/while-suspended");

		expect(refused.status).toBe(403);
		await expect(refused.json()).resolves.toMatchObject({
			code: "forbidden",
			message: "This account is suspended."
		});
		const db = drizzle(env.DB);
		expect(await db.select().from(links).all()).toEqual([]);

		await db
			.update(users)
			.set({ suspendedAt: null })
			.where(eq(users.id, "user_suspended"))
			.run();
		expect((await create("https://example.com/after-unsuspend")).status).toBe(
			201
		);
	});
});
