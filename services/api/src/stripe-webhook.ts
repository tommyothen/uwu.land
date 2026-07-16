import type { Context } from "hono";
import {
	configuredPriceIds,
	ENTITLING_STATUS_SQL
} from "./billing-shared";
import { bufferToHex } from "./crypto-utils";
import { isDeletedUser } from "./deletion";
import { isRecord, readJson } from "./request-utils";
import type { Env } from "./worker";

const RELEVANT_EVENT_TYPES = new Set([
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.paused",
	"customer.subscription.resumed",
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

interface ParsedSubscriptionEvent {
	eventId: string;
	eventTimestamp: number;
	subscriptionId: string;
	customerId: string;
	priceId: string;
	status: SubscriptionStatus | (string & {});
}

interface SubscriptionEvent extends ParsedSubscriptionEvent {
	userId: string;
}

// The deleted_users guard is folded into each upsert (INSERT ... SELECT ...
// WHERE NOT EXISTS) so the write itself is atomic against a deletion
// committing after the isDeletedUser fast path in stripeWebhook.
const UPSERT_SUBSCRIPTION_STRICT =
	"INSERT INTO stripe_subscriptions (id, customer_id, price_id, user_id, status, event_timestamp, event_id) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (id) DO UPDATE SET customer_id = excluded.customer_id, price_id = excluded.price_id, user_id = excluded.user_id, status = excluded.status, event_timestamp = excluded.event_timestamp, event_id = excluded.event_id WHERE excluded.event_timestamp > stripe_subscriptions.event_timestamp";
const UPSERT_SUBSCRIPTION_DELETED =
	"INSERT INTO stripe_subscriptions (id, customer_id, price_id, user_id, status, event_timestamp, event_id) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (id) DO UPDATE SET customer_id = excluded.customer_id, price_id = excluded.price_id, user_id = excluded.user_id, status = excluded.status, event_timestamp = excluded.event_timestamp, event_id = excluded.event_id WHERE excluded.event_timestamp >= stripe_subscriptions.event_timestamp";

export async function stripeWebhook(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const rawBody = await c.req.text();
	const signature = c.req.header("Stripe-Signature");
	const secret = c.env.STRIPE_WEBHOOK_SECRET;
	if (
		secret === undefined ||
		secret.length === 0 ||
		signature === undefined ||
		!(await verifyStripeSignature(rawBody, signature, secret))
	) {
		return c.text("Invalid webhook signature.", 400);
	}

	const rawEvent = await readJson(rawBody);
	if (
		!isRecord(rawEvent) ||
		typeof rawEvent.id !== "string" ||
		rawEvent.id.length === 0 ||
		typeof rawEvent.type !== "string"
	) {
		return c.text("Invalid webhook payload.", 400);
	}

	const replay = await c.env.DB.prepare(
		"SELECT 1 FROM stripe_webhook_events WHERE id = ?"
	)
		.bind(rawEvent.id)
		.first();
	if (replay !== null) {
		return new Response(null, { status: 200 });
	}
	if (!RELEVANT_EVENT_TYPES.has(rawEvent.type)) {
		return new Response(null, { status: 200 });
	}

	const object =
		isRecord(rawEvent.data) && isRecord(rawEvent.data.object)
			? rawEvent.data.object
			: null;
	const parsed = parseSubscriptionEvent(rawEvent, object);
	if (parsed === null) {
		return c.text("Invalid webhook payload.", 400);
	}

	const [existing, existingCustomer] = await Promise.all([
		c.env.DB.prepare(
			"SELECT user_id FROM stripe_subscriptions WHERE id = ?"
		)
			.bind(parsed.subscriptionId)
			.first<{ user_id: string }>(),
		c.env.DB.prepare(
			"SELECT user_id FROM stripe_customers WHERE customer_id = ?"
		)
			.bind(parsed.customerId)
			.first<{ user_id: string }>()
	]);
	const metadata = object !== null && isRecord(object.metadata)
		? object.metadata
		: null;
	const metadataUserId = metadata?.userId;
	const userId =
		typeof metadataUserId === "string" && metadataUserId.length > 0
			? metadataUserId
			: existing?.user_id;
	if (userId === undefined) {
		return new Response(null, { status: 200 });
	}

	if (await isDeletedUser(c.env.DB, userId)) {
		// Deletion already cancelled what it could; a late subscription event
		// must not resurrect the users/customers/subscriptions rows. Mark the
		// event processed so redelivery stays a no-op.
		await c.env.DB.prepare(
			"INSERT INTO stripe_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
		)
			.bind(parsed.eventId, parsed.eventTimestamp, Date.now())
			.run();
		return new Response(null, { status: 200 });
	}

	await applySubscriptionEvent(
		c.env.DB,
		c.env,
		{ ...parsed, userId },
		rawEvent.type === "customer.subscription.deleted",
		existing?.user_id,
		existingCustomer?.user_id ?? userId
	);
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
	const expectedBytes = encoder.encode(bufferToHex(digest));
	return signatures.some((candidate) =>
		crypto.subtle.timingSafeEqual(expectedBytes, encoder.encode(candidate))
	);
}

function parseSubscriptionEvent(
	rawEvent: Record<string, unknown>,
	object: Record<string, unknown> | null
): ParsedSubscriptionEvent | null {
	const items = object !== null && isRecord(object.items) ? object.items : null;
	const firstItem =
		items !== null && Array.isArray(items.data) && isRecord(items.data[0])
			? items.data[0]
			: null;
	const price =
		firstItem !== null && isRecord(firstItem.price) ? firstItem.price : null;
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
		price === null ||
		typeof price.id !== "string" ||
		price.id.length === 0
	) {
		return null;
	}

	return {
		eventId: rawEvent.id,
		eventTimestamp: rawEvent.created,
		subscriptionId: object.id,
		customerId: object.customer,
		priceId: price.id,
		status: object.status
	};
}

// The write half of a subscription event. A deletion can commit between the
// isDeletedUser fast path in stripeWebhook and this batch, so every row
// creation folds the deleted_users guard into the statement itself and cannot
// resurrect a deleted account. Exported so the race test can run it with the
// deletion already committed.
export async function applySubscriptionEvent(
	db: D1Database,
	env: Env,
	event: SubscriptionEvent,
	isDeleted: boolean,
	oldUserId: string | undefined,
	customerMappingUserId: string
): Promise<void> {
	const nowMs = Date.now();
	const nowSeconds = Math.floor(nowMs / 1000);
	const [monthlyPriceId, yearlyPriceId] = configuredPriceIds(env);
	const tierUpdateSql = `UPDATE users SET tier = CASE WHEN EXISTS (SELECT 1 FROM stripe_subscriptions WHERE user_id = ? AND status IN (${ENTITLING_STATUS_SQL}) AND price_id IN (?, ?)) THEN 'pro' ELSE 'free' END WHERE id = ?`;
	const statements = [
		db
			.prepare(
				"INSERT INTO stripe_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, nowMs),
		db
			.prepare(
				"INSERT INTO users (id, tier, created_at) SELECT ?, 'free', ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.userId, nowSeconds, event.userId),
		db
			.prepare(
				"INSERT INTO stripe_customers (user_id, customer_id, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (user_id) DO NOTHING"
			)
			.bind(
				customerMappingUserId,
				event.customerId,
				nowSeconds,
				customerMappingUserId
			),
		db
			.prepare(
				isDeleted ? UPSERT_SUBSCRIPTION_DELETED : UPSERT_SUBSCRIPTION_STRICT
			)
			.bind(
				event.subscriptionId,
				event.customerId,
				event.priceId,
				event.userId,
				event.status,
				event.eventTimestamp,
				event.eventId,
				event.userId
			),
		db
			.prepare(tierUpdateSql)
			.bind(
				event.userId,
				monthlyPriceId,
				yearlyPriceId,
				event.userId
			)
	];
	if (oldUserId !== undefined && oldUserId !== event.userId) {
		statements.push(
			db
				.prepare(tierUpdateSql)
				.bind(oldUserId, monthlyPriceId, yearlyPriceId, oldUserId)
		);
	}
	await db.batch(statements);
}
