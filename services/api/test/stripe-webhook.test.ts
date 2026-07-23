import { createExecutionContext, env } from "cloudflare:test";
import {
	deletedUsers,
	stripeCustomers,
	stripeLifetimePurchases,
	stripeSubscriptions,
	stripeWebhookEvents,
	users
} from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySubscriptionEvent, stripeWebhook } from "../src/stripe-webhook";
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

interface SessionPayload {
	id: string;
	type: string;
	created: number;
	data: {
		object: {
			id: string;
			customer: string;
			mode: string;
			payment_status: string;
			payment_intent?: string;
			client_reference_id?: string;
			metadata: Record<string, string>;
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

	it("cancels the subscription in Stripe when a deleted user's checkout completes late", async () => {
		// A Checkout session finished after the account deletion creates a live
		// subscription we hold no rows for. The backstop must cancel it in
		// Stripe so it cannot keep billing.
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_erased", deletedAt: new Date() })
			.run();
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ status: "canceled" })
		);

		const response = await sendInjectedWebhook(
			payload("customer.subscription.created", "active", {
				eventId: "evt_backstop_cancel",
				userId: "user_erased",
				subscriptionId: "sub_backstop"
			}),
			{ stripeFetch }
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = stripeFetch.mock.calls[0] ?? [];
		expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_backstop");
		expect(init?.method).toBe("DELETE");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer sk_test_stripe_backstop"
		);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_backstop_cancel" }]);
		expect(await drizzle(env.DB).select().from(users).all()).toEqual([]);
		expect(
			await drizzle(env.DB).select().from(stripeSubscriptions).all()
		).toEqual([]);
	});

	it("returns 500 without recording the event when the backstop cancel fails", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_erased", deletedAt: new Date() })
			.run();
		const failingFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: { type: "api_error", code: "api_error" } },
				{ status: 500 }
			)
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const event = payload("customer.subscription.created", "active", {
			eventId: "evt_backstop_retry",
			userId: "user_erased",
			subscriptionId: "sub_backstop_retry"
		});

		const failed = await sendInjectedWebhook(event, {
			stripeFetch: failingFetch
		});

		expect(failed.status).toBe(500);
		expect(consoleError).toHaveBeenCalled();
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toEqual([]);

		// The event was not recorded, so Stripe's retry passes the replay check
		// and re-attempts the cancel.
		const succeedingFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ status: "canceled" })
		);
		const retried = await sendInjectedWebhook(event, {
			stripeFetch: succeedingFetch
		});

		expect(retried.status).toBe(200);
		expect(succeedingFetch).toHaveBeenCalledTimes(1);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_backstop_retry" }]);
		consoleError.mockRestore();
	});

	it("does not attempt a cancel for a deleted user's cancellation echo", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_erased", deletedAt: new Date() })
			.run();
		const stripeFetch = vi.fn<typeof fetch>();

		const response = await sendInjectedWebhook(
			payload("customer.subscription.deleted", "canceled", {
				eventId: "evt_echo_no_cancel",
				userId: "user_erased",
				subscriptionId: "sub_echo_no_cancel"
			}),
			{ stripeFetch }
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).not.toHaveBeenCalled();
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_echo_no_cancel" }]);
	});

	it("acknowledges and logs when the backstop has no secret to cancel with", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_erased", deletedAt: new Date() })
			.run();
		const stripeFetch = vi.fn<typeof fetch>();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const response = await sendInjectedWebhook(
			payload("customer.subscription.created", "active", {
				eventId: "evt_backstop_no_secret",
				userId: "user_erased",
				subscriptionId: "sub_backstop_no_secret"
			}),
			{ stripeFetch, envOverride: { STRIPE_SECRET_KEY: undefined } }
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_backstop_no_secret" }]);
		consoleError.mockRestore();
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
			payload("invoice.payment_succeeded", "active")
		);

		expect(response.status).toBe(200);
		expect(await drizzle(env.DB).select().from(stripeWebhookEvents).all()).toEqual([]);
	});
});

describe("Stripe lifetime checkout webhook", () => {
	const LIFETIME_ENV = {
		...testEnv,
		STRIPE_SECRET_KEY: "sk_test_stripe_backstop"
	} as Env;

	it("entitles a completed launch-price lifetime session", async () => {
		const response = await sendWebhook(
			sessionPayload({
				eventId: "evt_life_launch",
				metadataUserId: "user_life",
				sessionId: "cs_life",
				paymentIntent: "pi_test"
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_life")).toBe("pro");
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toMatchObject([
			{
				id: "cs_life",
				paymentIntentId: "pi_test",
				customerId: "cus_test",
				priceId: env.STRIPE_PRICE_ID_LIFETIME_LAUNCH,
				userId: "user_life",
				status: "paid",
				eventId: "evt_life_launch"
			}
		]);
		expect(
			await drizzle(env.DB).select().from(stripeCustomers).all()
		).toMatchObject([{ userId: "user_life", customerId: "cus_test" }]);
	});

	it("entitles a completed regular-price lifetime session", async () => {
		const response = await sendWebhook(
			sessionPayload({
				metadataUserId: "user_regular",
				sessionId: "cs_regular",
				priceId: env.STRIPE_PRICE_ID_LIFETIME
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_regular")).toBe("pro");
		expect(
			(await drizzle(env.DB).select().from(stripeLifetimePurchases).all())[0]
				?.priceId
		).toBe(env.STRIPE_PRICE_ID_LIFETIME);
	});

	it("short-circuits a replayed lifetime event", async () => {
		const first = sessionPayload({
			eventId: "evt_life_replay",
			metadataUserId: "user_replay_life",
			sessionId: "cs_replay_life"
		});

		await sendWebhook(first);
		const response = await sendWebhook(first);

		expect(response.status).toBe(200);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toHaveLength(1);
	});

	it("writes one row for a repeated session under a new event id", async () => {
		await sendWebhook(
			sessionPayload({
				eventId: "evt_life_a",
				metadataUserId: "user_dup",
				sessionId: "cs_dup"
			})
		);
		const response = await sendWebhook(
			sessionPayload({
				eventId: "evt_life_b",
				metadataUserId: "user_dup",
				sessionId: "cs_dup"
			})
		);

		expect(response.status).toBe(200);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toHaveLength(1);
	});

	it("acknowledges a subscription-mode checkout without a lifetime row", async () => {
		const response = await sendWebhook(
			sessionPayload({
				eventId: "evt_sub_mode",
				metadataUserId: "user_sub_mode",
				mode: "subscription"
			})
		);

		expect(response.status).toBe(200);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_sub_mode" }]);
	});

	it("ignores an unpaid lifetime session", async () => {
		const response = await sendWebhook(
			sessionPayload({
				metadataUserId: "user_unpaid",
				paymentStatus: "unpaid"
			})
		);

		expect(response.status).toBe(200);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);
	});

	it("ignores a session on an unrecognised price", async () => {
		const response = await sendWebhook(
			sessionPayload({
				metadataUserId: "user_bad_price",
				priceId: "price_not_lifetime"
			})
		);

		expect(response.status).toBe(200);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);
	});

	it("acknowledges an unattributable lifetime session without a row", async () => {
		const response = await sendWebhook(
			sessionPayload({
				eventId: "evt_orphan",
				metadataUserId: null,
				customer: "cus_unknown"
			})
		);

		expect(response.status).toBe(200);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_orphan" }]);
	});

	it("rejects a lifetime session missing its payment intent", async () => {
		const response = await sendWebhook(
			sessionPayload({
				metadataUserId: "user_no_pi",
				paymentIntent: null
			})
		);

		expect(response.status).toBe(400);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toEqual([]);
	});

	it("cancels a live subscription when a lifetime upgrade completes", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_upgrade",
				subscriptionId: "sub_upgrade"
			})
		);
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ status: "canceled" })
		);
		const upgradeApp = createApp({ stripeFetch });

		const response = await upgradeApp.fetch(
			await signedRequest(
				sessionPayload({
					eventId: "evt_upgrade",
					metadataUserId: "user_upgrade",
					sessionId: "cs_upgrade"
				})
			),
			LIFETIME_ENV,
			createExecutionContext()
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = stripeFetch.mock.calls[0] ?? [];
		expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_upgrade");
		expect(init?.method).toBe("DELETE");
		expect(await findTier("user_upgrade")).toBe("pro");
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toHaveLength(1);
	});

	it("fails closed without recording when an upgrade cancel fails", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_upgrade_fail",
				subscriptionId: "sub_upgrade_fail"
			})
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const failingFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: { type: "api_error", code: "api_error" } },
				{ status: 500 }
			)
		);
		const event = sessionPayload({
			eventId: "evt_upgrade_fail",
			metadataUserId: "user_upgrade_fail",
			sessionId: "cs_upgrade_fail"
		});

		const failed = await createApp({ stripeFetch: failingFetch }).fetch(
			await signedRequest(event),
			LIFETIME_ENV,
			createExecutionContext()
		);

		expect(failed.status).toBe(500);
		expect(await findWebhookEvent("evt_upgrade_fail")).toBeUndefined();
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);

		const succeedingFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ status: "canceled" })
		);
		const retried = await createApp({ stripeFetch: succeedingFetch }).fetch(
			await signedRequest(event),
			LIFETIME_ENV,
			createExecutionContext()
		);

		expect(retried.status).toBe(200);
		expect(succeedingFetch).toHaveBeenCalledTimes(1);
		expect(await findWebhookEvent("evt_upgrade_fail")).toBeDefined();
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toHaveLength(1);
		consoleError.mockRestore();
	});

	it("refunds and records but never entitles a deleted user's purchase", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_gone", deletedAt: new Date() })
			.run();
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ id: "re_test", status: "succeeded" })
		);

		const response = await createApp({ stripeFetch }).fetch(
			await signedRequest(
				sessionPayload({
					eventId: "evt_gone",
					metadataUserId: "user_gone",
					sessionId: "cs_gone",
					paymentIntent: "pi_test"
				})
			),
			LIFETIME_ENV,
			createExecutionContext()
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = stripeFetch.mock.calls[0] ?? [];
		expect(url).toBe("https://api.stripe.com/v1/refunds");
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer sk_test_stripe_backstop"
		);
		expect(String(init?.body)).toBe("payment_intent=pi_test");
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_gone" }]);
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);
		expect(await drizzle(env.DB).select().from(users).all()).toEqual([]);
	});

	it("returns 500 without recording when a deleted user's refund fails", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_gone_retry", deletedAt: new Date() })
			.run();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const failingFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: { type: "api_error", code: "api_error" } },
				{ status: 500 }
			)
		);
		const event = sessionPayload({
			eventId: "evt_gone_retry",
			metadataUserId: "user_gone_retry",
			sessionId: "cs_gone_retry",
			paymentIntent: "pi_retry"
		});

		const failed = await createApp({ stripeFetch: failingFetch }).fetch(
			await signedRequest(event),
			LIFETIME_ENV,
			createExecutionContext()
		);

		expect(failed.status).toBe(500);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toEqual([]);

		const succeedingFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ id: "re_test", status: "succeeded" })
		);
		const retried = await createApp({ stripeFetch: succeedingFetch }).fetch(
			await signedRequest(event),
			LIFETIME_ENV,
			createExecutionContext()
		);

		expect(retried.status).toBe(200);
		expect(succeedingFetch).toHaveBeenCalledTimes(1);
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toMatchObject([{ id: "evt_gone_retry" }]);
		consoleError.mockRestore();
	});

	it("acknowledges and logs when a deleted user's refund has no secret", async () => {
		await drizzle(env.DB)
			.insert(deletedUsers)
			.values({ userId: "user_gone_nokey", deletedAt: new Date() })
			.run();
		const stripeFetch = vi.fn<typeof fetch>();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const response = await createApp({ stripeFetch }).fetch(
			await signedRequest(
				sessionPayload({
					eventId: "evt_gone_nokey",
					metadataUserId: "user_gone_nokey",
					sessionId: "cs_gone_nokey"
				})
			),
			{ ...LIFETIME_ENV, STRIPE_SECRET_KEY: undefined },
			createExecutionContext()
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();
		expect(await findWebhookEvent("evt_gone_nokey")).toBeDefined();
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toEqual([]);
		expect(await drizzle(env.DB).select().from(users).all()).toEqual([]);
		consoleError.mockRestore();
	});

	it("entitles the upgrade but logs when live subs cannot be cancelled", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_upgrade_nokey",
				subscriptionId: "sub_upgrade_nokey"
			})
		);
		const stripeFetch = vi.fn<typeof fetch>();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const response = await createApp({ stripeFetch }).fetch(
			await signedRequest(
				sessionPayload({
					eventId: "evt_upgrade_nokey",
					metadataUserId: "user_upgrade_nokey",
					sessionId: "cs_upgrade_nokey"
				})
			),
			{ ...LIFETIME_ENV, STRIPE_SECRET_KEY: undefined },
			createExecutionContext()
		);

		expect(response.status).toBe(200);
		expect(stripeFetch).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();
		expect(await findTier("user_upgrade_nokey")).toBe("pro");
		expect(
			await drizzle(env.DB).select().from(stripeLifetimePurchases).all()
		).toHaveLength(1);
		consoleError.mockRestore();
	});

	it("keeps a lifetime holder pro when their subscription is deleted", async () => {
		await sendWebhook(
			sessionPayload({
				eventId: "evt_both_life",
				metadataUserId: "user_both",
				sessionId: "cs_both",
				paymentIntent: "pi_both"
			})
		);
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_both",
				subscriptionId: "sub_both",
				eventTimestamp: 100
			})
		);

		const response = await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				userId: "user_both",
				subscriptionId: "sub_both",
				eventTimestamp: 200
			})
		);

		expect(response.status).toBe(200);
		expect(await findTier("user_both")).toBe("pro");
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

// Builds a checkout.session.completed envelope. Attribution (metadataUserId,
// clientReferenceId) and price are controlled independently so each test can
// exercise exactly the branch it targets. `null` omits a field; `undefined`
// falls back to the lifetime default.
function sessionPayload(
	options: {
		eventId?: string;
		eventTimestamp?: number;
		sessionId?: string;
		customer?: string;
		mode?: string;
		paymentStatus?: string;
		paymentIntent?: string | null;
		metadataUserId?: string | null;
		clientReferenceId?: string;
		priceId?: string;
	} = {}
): SessionPayload {
	const metadata: Record<string, string> = {
		priceId: options.priceId ?? env.STRIPE_PRICE_ID_LIFETIME_LAUNCH
	};
	if (options.metadataUserId !== null) {
		metadata.userId = options.metadataUserId ?? "user_life";
	}
	const object: SessionPayload["data"]["object"] = {
		id: options.sessionId ?? "cs_test",
		customer: options.customer ?? "cus_test",
		mode: options.mode ?? "payment",
		payment_status: options.paymentStatus ?? "paid",
		metadata
	};
	if (options.paymentIntent !== null) {
		object.payment_intent = options.paymentIntent ?? "pi_test";
	}
	if (options.clientReferenceId !== undefined) {
		object.client_reference_id = options.clientReferenceId;
	}
	return {
		id: options.eventId ?? `evt_${crypto.randomUUID()}`,
		type: "checkout.session.completed",
		created: options.eventTimestamp ?? 100,
		data: { object }
	};
}

async function sendWebhook(
	payloadValue: StripePayload | SessionPayload,
	options: { signatureTimestamp?: number; extraV1?: string } = {}
): Promise<Response> {
	return app.fetch(
		await signedRequest(payloadValue, options),
		testEnv,
		createExecutionContext()
	);
}

// worker.ts registers stripeWebhook bare (default global fetch), so tests
// that need to observe the deleted-user backstop's Stripe call route through
// a local app that injects stripeFetch.
async function sendInjectedWebhook(
	payloadValue: StripePayload,
	options: {
		stripeFetch?: typeof fetch;
		envOverride?: Partial<Env>;
	} = {}
): Promise<Response> {
	const injectedApp = new Hono<{ Bindings: Env }>();
	injectedApp.post("/webhooks/stripe", (c) =>
		stripeWebhook(c, { stripeFetch: options.stripeFetch })
	);
	return injectedApp.fetch(
		await signedRequest(payloadValue),
		{
			...testEnv,
			STRIPE_SECRET_KEY: "sk_test_stripe_backstop",
			...options.envOverride
		},
		createExecutionContext()
	);
}

async function signedRequest(
	payloadValue: StripePayload | SessionPayload,
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

async function findWebhookEvent(id: string) {
	const [event] = await drizzle(env.DB)
		.select()
		.from(stripeWebhookEvents)
		.where(eq(stripeWebhookEvents.id, id))
		.limit(1)
		.all();
	return event;
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
