import { createExecutionContext, env } from "cloudflare:test";
import { stripeSubscriptions, stripeWebhookEvents, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
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

	it("rejects a stale signature timestamp", async () => {
		const response = await sendWebhook(
			payload("customer.subscription.created", "active"),
			{ signatureTimestamp: Math.floor(Date.now() / 1000) - 301 }
		);

		expect(response.status).toBe(400);
	});

	it("sets the user to pro when a subscription is created active", async () => {
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
				userId: "user_paid",
				status: "active"
			}
		]);
	});

	it("sets the user to free when the subscription is deleted as canceled", async () => {
		await sendWebhook(
			payload("customer.subscription.created", "active", {
				userId: "user_deleted",
				subscriptionId: "sub_deleted",
				eventTimestamp: 100
			})
		);

		await sendWebhook(
			payload("customer.subscription.deleted", "canceled", {
				userId: "user_deleted",
				subscriptionId: "sub_deleted",
				eventTimestamp: 200
			})
		);

		expect(await findTier("user_deleted")).toBe("free");
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
		const [subscription] = await drizzle(env.DB)
			.select()
			.from(stripeSubscriptions)
			.where(eq(stripeSubscriptions.id, "sub_ordered"))
			.all();
		expect(subscription?.status).toBe("active");
	});

	it("deduplicates a repeated event id", async () => {
		const event = payload("customer.subscription.created", "active", {
			eventId: "evt_duplicate",
			userId: "user_duplicate"
		});

		await sendWebhook(event);
		await sendWebhook(event);

		expect(await findTier("user_duplicate")).toBe("pro");
		expect(
			await drizzle(env.DB).select().from(stripeWebhookEvents).all()
		).toHaveLength(1);
		expect(
			await drizzle(env.DB).select().from(stripeSubscriptions).all()
		).toHaveLength(1);
	});

	it("acknowledges a subscription without metadata.userId without mutation", async () => {
		const event = payload("customer.subscription.created", "active");
		delete event.data.object.metadata.userId;

		const response = await sendWebhook(event);

		expect(response.status).toBe(200);
		expect(await drizzle(env.DB).select().from(stripeWebhookEvents).all()).toEqual([]);
		expect(await drizzle(env.DB).select().from(stripeSubscriptions).all()).toEqual([]);
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
				customer: "cus_test",
				status,
				metadata: { userId }
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
