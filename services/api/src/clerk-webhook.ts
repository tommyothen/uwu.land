import { verifyWebhook } from "@clerk/backend/webhooks";
import type { Context } from "hono";
import type { Env } from "./worker";

const FIRST_CLASS_PLAN = "first_class";
const RELEVANT_EVENT_TYPES = new Set([
	"subscriptionItem.active",
	"subscriptionItem.canceled",
	"subscriptionItem.ended",
	"subscriptionItem.abandoned"
]);

type ItemStatus = "active" | "canceled" | "ended" | "abandoned";

interface BillingEvent {
	eventId: string;
	eventTimestamp: number;
	itemId: string;
	payerUserId: string;
	planSlug: string;
	status: ItemStatus;
}

export async function clerkWebhook(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const rawRequest = c.req.raw.clone();
	let verified: { type: string; data: unknown };
	let rawEvent: unknown;
	try {
		verified = await verifyWebhook(c.req.raw, {
			signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET
		});
		rawEvent = await rawRequest.json();
	} catch {
		return c.text("Invalid webhook signature.", 400);
	}

	if (!RELEVANT_EVENT_TYPES.has(verified.type)) {
		return new Response(null, { status: 200 });
	}

	const timestamp = isRecord(rawEvent) ? rawEvent.timestamp : null;
	const event = parseBillingEvent(verified, c.req.header("svix-id") ?? null, timestamp);
	if (event === null) {
		return c.text("Invalid billing webhook payload.", 400);
	}

	if (event.planSlug !== FIRST_CLASS_PLAN) {
		return new Response(null, { status: 200 });
	}

	await applyBillingEvent(c.env.DB, event);
	return new Response(null, { status: 200 });
}

function parseBillingEvent(
	event: { type: string; data: unknown },
	eventId: string | null,
	eventTimestamp: unknown
): BillingEvent | null {
	if (!isRecord(event.data)) {
		return null;
	}
	const payer = isRecord(event.data.payer) ? event.data.payer : null;
	const plan = isRecord(event.data.plan) ? event.data.plan : null;
	const status = event.type.slice("subscriptionItem.".length);

	if (
		eventId === null ||
		typeof eventTimestamp !== "number" ||
		!Number.isSafeInteger(eventTimestamp) ||
		typeof event.data.id !== "string" ||
		event.data.id.length === 0 ||
		payer === null ||
		typeof payer.user_id !== "string" ||
		payer.user_id.length === 0 ||
		plan === null ||
		typeof plan.slug !== "string" ||
		plan.slug.length === 0 ||
		!isItemStatus(status) ||
		event.data.status !== status
	) {
		return null;
	}

	return {
		eventId,
		eventTimestamp,
		itemId: event.data.id,
		payerUserId: payer.user_id,
		planSlug: plan.slug,
		status
	};
}

async function applyBillingEvent(
	db: D1Database,
	event: BillingEvent
): Promise<void> {
	const paidStatus = event.status === "active" || event.status === "canceled";

	await db.batch([
		db
			.prepare(
				"INSERT INTO clerk_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, Date.now()),
		db
			.prepare(
				"INSERT INTO users (id, tier, created_at) SELECT ?, 'free', ? WHERE ? = 1 ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.payerUserId, Math.floor(Date.now() / 1000), paidStatus ? 1 : 0),
		db
			.prepare(
				"INSERT INTO clerk_subscription_items (id, payer_user_id, plan_slug, status, event_timestamp, event_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET payer_user_id = excluded.payer_user_id, plan_slug = excluded.plan_slug, status = excluded.status, event_timestamp = excluded.event_timestamp, event_id = excluded.event_id WHERE excluded.event_timestamp > clerk_subscription_items.event_timestamp"
			)
			.bind(
				event.itemId,
				event.payerUserId,
				event.planSlug,
				event.status,
				event.eventTimestamp,
				event.eventId
			),
		db
			.prepare(
				"UPDATE users SET tier = CASE WHEN EXISTS (SELECT 1 FROM clerk_subscription_items WHERE payer_user_id = ? AND plan_slug = ? AND status IN ('active', 'canceled')) THEN 'pro' ELSE 'free' END WHERE id = ?"
			)
			.bind(event.payerUserId, FIRST_CLASS_PLAN, event.payerUserId)
	]);
}

function isItemStatus(value: string): value is ItemStatus {
	return (
		value === "active" ||
		value === "canceled" ||
		value === "ended" ||
		value === "abandoned"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
