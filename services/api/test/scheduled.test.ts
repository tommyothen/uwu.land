import {
	createExecutionContext,
	createScheduledController,
	env,
	waitOnExecutionContext
} from "cloudflare:test";
import { accountTombstones, deletedUsers } from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_TOMBSTONE_WINDOW_SECONDS } from "../src/clerk-webhook";
import type { Env } from "../src/worker";
import { createWorker } from "../src/worker";
import { resetD1 } from "./helpers/d1";

beforeEach(async () => {
	await resetD1(env.DB);
});

describe("scheduled maintenance", () => {
	it("purges only tombstones older than the account-deletion window on the daily cron", async () => {
		const now = Date.now();
		const db = drizzle(env.DB);
		await db
			.insert(accountTombstones)
			.values([
				{
					eventId: "delete_expired",
					emailHash: "expired_hash",
					deletedAt: new Date(
						now - (ACCOUNT_TOMBSTONE_WINDOW_SECONDS + 86_400) * 1000
					)
				},
				{
					eventId: "delete_recent",
					emailHash: "recent_hash",
					deletedAt: new Date(
						now - (ACCOUNT_TOMBSTONE_WINDOW_SECONDS - 86_400) * 1000
					)
				}
			])
			.run();
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }))
		);

		try {
			const scheduled = createWorker().scheduled;
			if (scheduled === undefined) {
				throw new Error("Worker scheduled handler is missing");
			}
			const ctx = createExecutionContext();
			await scheduled(
				createScheduledController({ cron: "0 6 * * *", scheduledTime: now }),
				env as Env,
				ctx
			);
			await waitOnExecutionContext(ctx);
		} finally {
			vi.unstubAllGlobals();
		}

		expect(await db.select().from(accountTombstones).all()).toMatchObject([
			{ eventId: "delete_recent", emailHash: "recent_hash" }
		]);
	});

	it("cancels a deleted user's orphaned Stripe subscription on the daily cron", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_gone", deletedAt: new Date() })
			.run();
		const cancelRequests: string[] = [];
		const stripeFetch = vi.fn<typeof fetch>(async (input, init) => {
			if (init?.method === "DELETE") {
				cancelRequests.push(String(input));
				return Response.json({ status: "canceled" });
			}
			return Response.json({
				object: "list",
				data: [
					{
						id: "sub_orphan",
						object: "subscription",
						status: "active",
						metadata: { userId: "user_gone" }
					}
				],
				has_more: false
			});
		});
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }))
		);

		try {
			const scheduled = createWorker({ stripeFetch }).scheduled;
			if (scheduled === undefined) {
				throw new Error("Worker scheduled handler is missing");
			}
			const ctx = createExecutionContext();
			await scheduled(
				createScheduledController({
					cron: "0 6 * * *",
					scheduledTime: Date.now()
				}),
				{ ...env, STRIPE_SECRET_KEY: "sk_test_sweep" } as Env,
				ctx
			);
			await waitOnExecutionContext(ctx);
		} finally {
			vi.unstubAllGlobals();
		}

		expect(cancelRequests).toEqual([
			"https://api.stripe.com/v1/subscriptions/sub_orphan"
		]);
	});
});
