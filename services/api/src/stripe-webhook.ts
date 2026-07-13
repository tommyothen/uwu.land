import type { Context } from "hono";
import type { Env } from "./worker";

const RELEVANT_EVENT_TYPES = new Set([
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted"
]);
const SIGNATURE_TOLERANCE_SECONDS = 300;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/i;

type SubscriptionStatus =
	| "active"
	| "trialing"
	| "past_due"
	| "canceled"
	| "unpaid"
	| "incomplete"
	| "incomplete_expired"
	| "paused";

interface SubscriptionEvent {
	eventId: string;
	eventTimestamp: number;
	subscriptionId: string;
	customerId: string;
	userId: string;
	status: SubscriptionStatus;
}

export async function stripeWebhook(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const rawBody = await c.req.text();
	const signature = c.req.header("Stripe-Signature");
	const secret = c.env.STRIPE_WEBHOOK_SECRET;
	if (
		secret === undefined ||
		signature === undefined ||
		!(await verifyStripeSignature(rawBody, signature, secret))
	) {
		return c.text("Invalid webhook signature.", 400);
	}

	let rawEvent: unknown;
	try {
		rawEvent = JSON.parse(rawBody);
	} catch {
		return c.text("Invalid webhook payload.", 400);
	}

	if (!isRecord(rawEvent) || typeof rawEvent.type !== "string") {
		return c.text("Invalid webhook payload.", 400);
	}
	if (!RELEVANT_EVENT_TYPES.has(rawEvent.type)) {
		return new Response(null, { status: 200 });
	}

	const object =
		isRecord(rawEvent.data) && isRecord(rawEvent.data.object)
			? rawEvent.data.object
			: null;
	const metadata = object !== null && isRecord(object.metadata)
		? object.metadata
		: null;
	const userId = metadata?.userId;
	if (typeof userId !== "string" || userId.length === 0) {
		return new Response(null, { status: 200 });
	}

	const event = parseSubscriptionEvent(rawEvent, object, userId);
	if (event === null) {
		return c.text("Invalid webhook payload.", 400);
	}

	await applySubscriptionEvent(c.env.DB, event);
	return new Response(null, { status: 200 });
}

async function verifyStripeSignature(
	rawBody: string,
	header: string,
	secret: string
): Promise<boolean> {
	let timestamp: number | null = null;
	const signatures: string[] = [];
	for (const part of header.split(",")) {
		const separator = part.indexOf("=");
		if (separator === -1) {
			continue;
		}
		const key = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (key === "t" && timestamp === null && /^\d+$/.test(value)) {
			const parsed = Number(value);
			if (Number.isSafeInteger(parsed)) {
				timestamp = parsed;
			}
		} else if (key === "v1" && HEX_SIGNATURE.test(value)) {
			signatures.push(value.toLowerCase());
		}
	}

	if (
		timestamp === null ||
		signatures.length === 0 ||
		Math.abs(Math.floor(Date.now() / 1000) - timestamp) >
			SIGNATURE_TOLERANCE_SECONDS
	) {
		return false;
	}

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const digest = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`${timestamp}.${rawBody}`)
	);
	const expected = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
	const expectedBytes = encoder.encode(expected);
	return signatures.some((candidate) =>
		crypto.subtle.timingSafeEqual(expectedBytes, encoder.encode(candidate))
	);
}

function parseSubscriptionEvent(
	rawEvent: Record<string, unknown>,
	object: Record<string, unknown> | null,
	userId: string
): SubscriptionEvent | null {
	if (
		object === null ||
		typeof rawEvent.id !== "string" ||
		rawEvent.id.length === 0 ||
		typeof rawEvent.created !== "number" ||
		!Number.isSafeInteger(rawEvent.created) ||
		typeof object.id !== "string" ||
		object.id.length === 0 ||
		typeof object.customer !== "string" ||
		object.customer.length === 0 ||
		typeof object.status !== "string" ||
		!isSubscriptionStatus(object.status)
	) {
		return null;
	}

	return {
		eventId: rawEvent.id,
		eventTimestamp: rawEvent.created,
		subscriptionId: object.id,
		customerId: object.customer,
		userId,
		status: object.status
	};
}

async function applySubscriptionEvent(
	db: D1Database,
	event: SubscriptionEvent
): Promise<void> {
	const nowMs = Date.now();
	await db.batch([
		db
			.prepare(
				"INSERT INTO stripe_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, nowMs),
		db
			.prepare(
				"INSERT INTO users (id, tier, created_at) VALUES (?, 'free', ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.userId, Math.floor(nowMs / 1000)),
		db
			.prepare(
				"INSERT INTO stripe_subscriptions (id, customer_id, user_id, status, event_timestamp, event_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET customer_id = excluded.customer_id, user_id = excluded.user_id, status = excluded.status, event_timestamp = excluded.event_timestamp, event_id = excluded.event_id WHERE excluded.event_timestamp >= stripe_subscriptions.event_timestamp"
			)
			.bind(
				event.subscriptionId,
				event.customerId,
				event.userId,
				event.status,
				event.eventTimestamp,
				event.eventId
			),
		db
			.prepare(
				"UPDATE users SET tier = CASE WHEN EXISTS (SELECT 1 FROM stripe_subscriptions WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due')) THEN 'pro' ELSE 'free' END WHERE id = ?"
			)
			.bind(event.userId, event.userId)
	]);
}

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
	return (
		value === "active" ||
		value === "trialing" ||
		value === "past_due" ||
		value === "canceled" ||
		value === "unpaid" ||
		value === "incomplete" ||
		value === "incomplete_expired" ||
		value === "paused"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
