import { env } from "cloudflare:test";
import { deletedUsers } from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sweepDeletedUserSubscriptions } from "../src/stripe-sweep";
import { resetD1 } from "./helpers/d1";

const SECRET = "sk_test_sweep";

interface FakeStripe {
	fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
	cancelRequests: string[];
	listRequests: string[];
}

// Serves the given subscription pages from the list endpoint (has_more while
// pages remain) and records cancels; cancelResponses overrides the default
// 200 per subscription id.
function fakeStripe(
	pages: Record<string, unknown>[][],
	cancelResponses: Record<string, () => Response> = {}
): FakeStripe {
	const cancelRequests: string[] = [];
	const listRequests: string[] = [];
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		const url = String(input);
		if (init?.method === "DELETE") {
			const subscriptionId = decodeURIComponent(
				url.slice(url.lastIndexOf("/") + 1)
			);
			cancelRequests.push(subscriptionId);
			const respond = cancelResponses[subscriptionId];
			return respond === undefined
				? Response.json({ status: "canceled" })
				: respond();
		}
		listRequests.push(url);
		const index = listRequests.length - 1;
		return Response.json({
			object: "list",
			data: pages[index] ?? [],
			has_more: index < pages.length - 1
		});
	});
	return { fetchImpl, cancelRequests, listRequests };
}

function subscription(
	id: string,
	userId: string | null,
	status = "active"
): Record<string, unknown> {
	return {
		id,
		object: "subscription",
		status,
		metadata: userId === null ? {} : { userId }
	};
}

async function markDeleted(userId: string): Promise<void> {
	await drizzle(env.DB)
		.insert(deletedUsers)
		.values({ userId, deletedAt: new Date() })
		.run();
}

describe("deleted-user subscription sweep", () => {
	beforeEach(async () => resetD1(env.DB));

	it("cancels only the subscriptions whose owners are deleted", async () => {
		await markDeleted("user_gone");
		const stripe = fakeStripe([
			[
				subscription("sub_live", "user_alive"),
				subscription("sub_orphan", "user_gone")
			]
		]);

		const result = await sweepDeletedUserSubscriptions(
			{ DB: env.DB, STRIPE_SECRET_KEY: SECRET },
			stripe.fetchImpl
		);

		expect(result).toEqual({
			scanned: 2,
			orphaned: 1,
			cancelled: 1,
			failed: 0,
			skipped: 0
		});
		expect(stripe.cancelRequests).toEqual(["sub_orphan"]);
		const [, init] = stripe.fetchImpl.mock.calls[0] ?? [];
		expect(new Headers(init?.headers).get("authorization")).toBe(
			`Bearer ${SECRET}`
		);
	});

	it("follows pagination and cancels an orphan on a later page", async () => {
		await markDeleted("user_gone");
		const stripe = fakeStripe([
			[
				subscription("sub_a", "user_alive"),
				subscription("sub_b", "user_alive")
			],
			[subscription("sub_late_orphan", "user_gone")]
		]);

		const result = await sweepDeletedUserSubscriptions(
			{ DB: env.DB, STRIPE_SECRET_KEY: SECRET },
			stripe.fetchImpl
		);

		expect(stripe.listRequests).toHaveLength(2);
		expect(stripe.listRequests[1]).toContain("starting_after=sub_b");
		expect(stripe.cancelRequests).toEqual(["sub_late_orphan"]);
		expect(result).toMatchObject({ scanned: 3, orphaned: 1, cancelled: 1 });
	});

	it("re-runs safely: an already-canceled orphan still counts as cancelled", async () => {
		// Stripe answering 404/resource_missing is the re-run shape: the
		// previous sweep (or the webhook backstop) already cancelled it.
		await markDeleted("user_gone");
		const alreadyGone = (): Response =>
			Response.json(
				{ error: { type: "invalid_request_error", code: "resource_missing" } },
				{ status: 404 }
			);

		for (let run = 0; run < 2; run++) {
			const stripe = fakeStripe(
				[[subscription("sub_orphan", "user_gone")]],
				{ sub_orphan: alreadyGone }
			);
			const result = await sweepDeletedUserSubscriptions(
				{ DB: env.DB, STRIPE_SECRET_KEY: SECRET },
				stripe.fetchImpl
			);
			expect(result).toMatchObject({
				orphaned: 1,
				cancelled: 1,
				failed: 0
			});
		}
	});

	it("keeps sweeping after a cancel failure", async () => {
		await markDeleted("user_gone");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const stripe = fakeStripe(
			[
				[
					subscription("sub_orphan_bad", "user_gone"),
					subscription("sub_orphan_good", "user_gone")
				]
			],
			{
				sub_orphan_bad: () =>
					Response.json(
						{ error: { type: "api_error", code: "api_error" } },
						{ status: 500 }
					)
			}
		);

		const result = await sweepDeletedUserSubscriptions(
			{ DB: env.DB, STRIPE_SECRET_KEY: SECRET },
			stripe.fetchImpl
		);

		expect(stripe.cancelRequests).toEqual([
			"sub_orphan_bad",
			"sub_orphan_good"
		]);
		expect(result).toMatchObject({ orphaned: 2, cancelled: 1, failed: 1 });
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("never cancels what it cannot attribute or what is already terminal", async () => {
		await markDeleted("user_gone");
		const stripe = fakeStripe([
			[
				subscription("sub_no_metadata", null),
				subscription("sub_expired", "user_gone", "incomplete_expired")
			]
		]);

		const result = await sweepDeletedUserSubscriptions(
			{ DB: env.DB, STRIPE_SECRET_KEY: SECRET },
			stripe.fetchImpl
		);

		expect(stripe.cancelRequests).toEqual([]);
		expect(result).toEqual({
			scanned: 2,
			orphaned: 0,
			cancelled: 0,
			failed: 0,
			skipped: 1
		});
	});

	it("logs and does nothing without a Stripe secret", async () => {
		await markDeleted("user_gone");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const stripe = fakeStripe([[subscription("sub_orphan", "user_gone")]]);

		const result = await sweepDeletedUserSubscriptions(
			{ DB: env.DB, STRIPE_SECRET_KEY: undefined },
			stripe.fetchImpl
		);

		expect(stripe.fetchImpl).not.toHaveBeenCalled();
		expect(result).toEqual({
			scanned: 0,
			orphaned: 0,
			cancelled: 0,
			failed: 0,
			skipped: 0
		});
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("returns gracefully when the subscriptions list fails", async () => {
		await markDeleted("user_gone");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const failingFetch = vi.fn<typeof fetch>(async () => {
			throw new Error("network down");
		});

		const result = await sweepDeletedUserSubscriptions(
			{ DB: env.DB, STRIPE_SECRET_KEY: SECRET },
			failingFetch
		);

		expect(result).toEqual({
			scanned: 0,
			orphaned: 0,
			cancelled: 0,
			failed: 0,
			skipped: 0
		});
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
