import { createExecutionContext, env } from "cloudflare:test";
import {
	deletedUsers,
	stripeCustomers,
	stripeSubscriptions,
	stripeWebhookEvents,
	users
} from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { applySubscriptionEvent } from "../src/stripe-webhook";
import type { Env } from "../src/worker";
import { createApp } from "../src/worker";
import { resetD1 } from "./helpers/d1";

const WEBHOOK_SECRET = "whsec_stripe_test_secret";
const WEBHOOK_URL = "https://uwu.land/webhooks/stripe";
const app = createApp();
const testEnv = {
	...env,
	STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET
} as Env;

interface StripePayload {
	id: string;
	type: string;
	created: number;
	data: {
		object: {
			id: string;
			customer: string;
			status: string;
			metadata: Record<string, string>;
			items: { data: Array<{ price: { id: string } }> };
		};
	};
}

beforeEach(async () => {
	await resetD1(env.DB);
});

describe("Stripe subscription webhook", () => {
	it("accepts a valid signature, including when another v1 is present", async () => {
		const request = await signedRequest(
			payload("customer.subscription.created", "active"),
			{ extraV1: "0".repeat(64) }
		);

		const response = await app.fetch(request, testEnv, createExecutionContext());

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("rejects a bad signature", async () => {
		const request = await signedRequest(
			payload("customer.subscription.created", "active")
		);
		request.headers.set(
			"Stripe-Signature",
			`t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`
		);

		const response = await app.fetch(request, testEnv, createExecutionContext());

		expect(response.status).toBe(400);
		expect(await drizzle(env.DB).select().from(stripeWebhookEvents).all()).toEqual([]);
	});

	it("rejects an empty webhook secret without throwing", async () => {
		const request = await signedRequest(
			payload("customer.subscription.created", "active")
		);
		const response = await app.fetch(
			request,
			{ ...testEnv, STRIPE_WEBHOOK_SECRET: "" },
			createExecutionContext()
		);

		expect(response.status).toBe(400);
	});

	it("rejects a stale signature timestamp", async () => {
		const response = await sendWebhook(
			payload("customer.subscription.created", "active"),
			{ signatureTimestamp: Math.floor(Date.now() / 1000) - 301 }
		);

		expect(response.status).toBe(400);
	});

	it("sets the user to pro for an active configured-price subscription", async () => {
		await drizzle(env.DB).insert(users).values({ id: "user_paid" }).run();

		const response = await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_paid",
				subscriptionId: "sub_paid"
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_paid")).toBe("pro");
		expect(
			await drizzle(env.DB).select().from(stripeSubscriptions).all()
		).toMatchObject([
			{
				id: "sub_paid",
				customerId: "cus_test",
				priceId: env.STRIPE_PRICE_ID_MONTHLY,
				userId: "user_paid",
				status: "active"
			}
		]);
	});

	it("keeps the user free for an entitling status on another price", async () => {
		const response = await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_other_price",
				priceId: "price_not_first_class"
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_other_price")).toBe("free");
	});

	it("records an unknown status and fails entitlement closed", async () => {
		const response = await sendWebhook(
			payload("customer.subscription.updated", "future_status", {
				userId: "user_future_status",
				subscriptionId: "sub_future_status"
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_future_status")).toBe("free");
		const subscription = await findSubscription("sub_future_status");
		expect(subscription?.status).toBe("future_status");
	});

	it("accepts paused events and treats paused as non-entitling", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_paused",
				subscriptionId: "sub_paused",
				eventTimestamp: 100
			})
		);
		const response = await sendWebhook(
			payload("customer.subscription.paused", "paused", {
				userId: "user_paused",
				subscriptionId: "sub_paused",
				eventTimestamp: 200
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_paused")).toBe("free");
		expect((await findSubscription("sub_paused"))?.status).toBe("paused");
	});

	it("makes same-second deletion win when update arrives first", async () => {
		await sendWebhook(
			payload("customer.subscription.updated", "active", {
				userId: "user_update_delete",
				subscriptionId: "sub_update_delete",
				eventTimestamp: 200
			})
		);
		await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				userId: "user_update_delete",
				subscriptionId: "sub_update_delete",
				eventTimestamp: 200
			})
		);

		expect((await findSubscription("sub_update_delete"))?.status).toBe("canceled");
		expect(await findTier("user_update_delete")).toBe("free");
	});

	it("makes same-second deletion stick when update arrives second", async () => {
		await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				userId: "user_delete_update",
				subscriptionId: "sub_delete_update",
				eventTimestamp: 200
			})
		);
		await sendWebhook(
			payload("customer.subscription.updated", "active", {
				userId: "user_delete_update",
				subscriptionId: "sub_delete_update",
				eventTimestamp: 200
			})
		);

		expect((await findSubscription("sub_delete_update"))?.status).toBe("canceled");
		expect(await findTier("user_delete_update")).toBe("free");
	});

	it("ignores an out-of-order older event", async () => {
		await sendWebhook(
			payload("customer.subscription.updated", "active", {
				userId: "user_ordered",
				subscriptionId: "sub_ordered",
				eventTimestamp: 200
			})
		);
		await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				userId: "user_ordered",
				subscriptionId: "sub_ordered",
				eventTimestamp: 100
			})
		);

		expect(await findTier("user_ordered")).toBe("pro");
		expect((await findSubscription("sub_ordered"))?.status).toBe("active");
	});

	it("short-circuits a replay before applying changed state", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				eventId: "evt_replay",
				userId: "user_replay",
				subscriptionId: "sub_replay",
				eventTimestamp: 100
			})
		);
		const response = await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				eventId: "evt_replay",
				userId: "user_replay",
				subscriptionId: "sub_replay",
				eventTimestamp: 200
			})
		);

		expect(response.status).toBe(200);
		expect((await findSubscription("sub_replay"))?.status).toBe("active");
		expect(await findTier("user_replay")).toBe("pro");
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toHaveLength(1);
	});

	it("uses the tracked owner for a metadata-less cancellation", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_tracked",
				subscriptionId: "sub_tracked",
				eventTimestamp: 100
			})
		);
		const event = payload("customer.subscription.deleted", "canceled", {
			userId: "unused",
			subscriptionId: "sub_tracked",
			eventTimestamp: 200
		});
		delete event.data.object.metadata.userId;

		const response = await sendWebhook(event);

		expect(response.status).toBe(200);
		expect(await findTier("user_tracked")).toBe("free");
	});

	it("acknowledges a metadata-less unknown subscription without mutation", async () => {
		const event = payload("customer.subscription.created", "active");
		delete event.data.object.metadata.userId;

		const response = await sendWebhook(event);

		expect(response.status).toBe(200);
		expect(await drizzle(env.DB).select().from(stripeWebhookEvents).all()).toEqual([]);
		expect(await drizzle(env.DB).select().from(stripeSubscriptions).all()).toEqual([]);
	});

	it("recomputes both users when subscription ownership changes", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_old_owner",
				subscriptionId: "sub_transferred",
				eventTimestamp: 100
			})
		);
		await sendWebhook(
			payload("customer.subscription.updated", "active", {
				userId: "user_new_owner",
				subscriptionId: "sub_transferred",
				eventTimestamp: 200
			})
		);

		expect(await findTier("user_old_owner")).toBe("free");
		expect(await findTier("user_new_owner")).toBe("pro");
		expect((await findSubscription("sub_transferred"))?.userId).toBe(
			"user_new_owner"
		);
	});

	it("does not resurrect a deleted user from a late subscription event", async () => {
		// Account deletion cancels the Stripe subscription, which makes Stripe
		// emit customer.subscription.deleted back at us after the local rows are
		// gone. That echo must not recreate the account.
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_erased", deletedAt: new Date() })
			.run();

		const response = await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				eventId: "evt_deleted_echo",
				userId: "user_erased",
				subscriptionId: "sub_erased",
				eventTimestamp: 200
			})
		);

		expect(response.status).toBe(200);
		expect(await drizzle(env.DB).select().from(users).all()).toEqual([]);
		expect(await drizzle(env.DB).select().from(stripeCustomers).all()).toEqual([]);
		expect(
			await drizzle(env.DB).select().from(stripeSubscriptions).all()
		).toEqual([]);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_deleted_echo" }]);
	});

	it("does not resurrect a deleted user when a deletion commits after the fast-path check", async () => {
		// Simulates the TOCTOU in stripeWebhook: the isDeletedUser fast path
		// passed, then the deletion committed before applySubscriptionEvent
		// ran. The guards folded into each write must refuse to recreate the
		// users, stripe_customers, and stripe_subscriptions rows. Both upsert
		// variants (live update and deletion echo) are exercised.
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_raced", deletedAt: new Date() })
			.run();

		for (const [eventId, isDeleted] of [
			["evt_raced_update", false],
			["evt_raced_delete", true]
		] as const) {
			await applySubscriptionEvent(
				env.DB,
				testEnv,
				{
					eventId,
					eventTimestamp: 200,
					subscriptionId: "sub_raced",
					customerId: "cus_raced",
					priceId: env.STRIPE_PRICE_ID_MONTHLY,
					status: isDeleted ? "canceled" : "active",
					userId: "user_raced"
				},
				isDeleted,
				undefined,
				"user_raced"
			);
		}

		expect(await drizzle(env.DB).select().from(users).all()).toEqual([]);
		expect(await drizzle(env.DB).select().from(stripeCustomers).all()).toEqual([]);
		expect(
			await drizzle(env.DB).select().from(stripeSubscriptions).all()
		).toEqual([]);
		// The events are still recorded so redelivery stays idempotent.
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_raced_update" }, { id: "evt_raced_delete" }]);
	});

	it("still applies subscription events for live users alongside a deleted one", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_erased", deletedAt: new Date() })
			.run();

		const response = await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_alive",
				subscriptionId: "sub_alive"
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_alive")).toBe("pro");
	});

	it("acknowledges an unknown event type without mutation", async () => {
		const response = await sendWebhook(
			payload("checkout.session.completed", "active")
		);

		expect(response.status).toBe(200);
		expect(await drizzle(env.DB).select().from(stripeWebhookEvents).all()).toEqual([]);
	});
});

function payload(
	type: string,
	status: string,
	options: {
		eventId?: string;
		eventTimestamp?: number;
		subscriptionId?: string;
		userId?: string;
		priceId?: string;
		customerId?: string;
	} = {}
): StripePayload {
	const userId = options.userId ?? "user_test";
	return {
		id: options.eventId ?? `evt_${crypto.randomUUID()}`,
		type,
		created: options.eventTimestamp ?? 100,
		data: {
			object: {
				id: options.subscriptionId ?? `sub_${userId}`,
				customer: options.customerId ?? "cus_test",
				status,
				metadata: { userId },
				items: {
					data: [
						{
							price: {
								id: options.priceId ?? env.STRIPE_PRICE_ID_MONTHLY
							}
						}
					]
				}
			}
		}
	};
}

async function sendWebhook(
	payloadValue: StripePayload,
	options: { signatureTimestamp?: number; extraV1?: string } = {}
): Promise<Response> {
	return app.fetch(
		await signedRequest(payloadValue, options),
		testEnv,
		createExecutionContext()
	);
}

async function signedRequest(
	payloadValue: StripePayload,
	options: { signatureTimestamp?: number; extraV1?: string } = {}
): Promise<Request> {
	const body = JSON.stringify(payloadValue);
	const timestamp =
		options.signatureTimestamp ?? Math.floor(Date.now() / 1000);
	const signature = await sign(`${timestamp}.${body}`);
	const extra = options.extraV1 === undefined ? "" : `,v1=${options.extraV1}`;
	return new Request(WEBHOOK_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"Stripe-Signature": `t=${timestamp}${extra},v1=${signature}`
		},
		body
	});
}

async function sign(value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value)
	);
	return Array.from(new Uint8Array(signature), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
}

async function findTier(userId: string): Promise<"free" | "pro" | undefined> {
	const [user] = await drizzle(env.DB)
		.select({ tier: users.tier })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1)
		.all();
	return user?.tier;
}

async function findSubscription(id: string) {
	const [subscription] = await drizzle(env.DB)
		.select()
		.from(stripeSubscriptions)
		.where(eq(stripeSubscriptions.id, id))
		.limit(1)
		.all();
	return subscription;
}
