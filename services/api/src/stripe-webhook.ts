import type { Context } from "hono";
import {
	configuredLifetimePriceIds,
	configuredPriceIds,
	ENTITLING_STATUS_SQL,
	TERMINAL_STATUS_SQL
} from "./billing-shared";
import { bufferToHex } from "./crypto-utils";
import { isDeletedUser } from "./deletion";
import { isRecord, readJson } from "./request-utils";
import { cancelStripeSubscription } from "./stripe-cancel";
import {
	paymentIntentRefundState,
	refundStripePaymentIntent
} from "./stripe-refund";
import type { Env } from "./worker";

const RELEVANT_EVENT_TYPES = new Set([
	"charge.refunded",
	"checkout.session.async_payment_succeeded",
	"checkout.session.completed",
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

export interface StripeWebhookOptions {
	stripeFetch?: typeof fetch;
}

export async function stripeWebhook(
	c: Context<{ Bindings: Env }>,
	options: StripeWebhookOptions = {}
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

	// async_payment_succeeded is the delayed-notification twin of
	// session.completed: a bank debit or transfer completes the session while
	// still `unpaid`, and this is the event that says the money arrived. Same
	// session shape, same handler — without it, enabling such a payment method
	// in the Stripe dashboard would take money that could never entitle anyone.
	if (
		rawEvent.type === "checkout.session.completed" ||
		rawEvent.type === "checkout.session.async_payment_succeeded"
	) {
		return handleCheckoutSessionCompleted(c, rawEvent, object, options);
	}

	if (rawEvent.type === "charge.refunded") {
		return handleChargeRefunded(c, rawEvent, object);
	}

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
		// Deletion already cancelled what it could, and a late subscription
		// event must not resurrect the users/customers/subscriptions rows. But
		// a Checkout session completed after the deletion creates a live
		// subscription with no account behind it, so a non-cancellation event
		// here is the backstop's cue to cancel that subscription in Stripe.
		// On a cancel failure we fail closed with a 500 and do NOT record the
		// event: the replay check above keys off the recorded row, so Stripe's
		// retry re-runs this branch and re-attempts the cancel. (Accepted
		// residual: the single first-invoice charge taken at checkout
		// completion is not refunded, and sessions are not expired here.)
		if (rawEvent.type !== "customer.subscription.deleted") {
			const stripeSecret = c.env.STRIPE_SECRET_KEY;
			if (stripeSecret === undefined || stripeSecret.length === 0) {
				// We cannot act without a key, and a 500 would just make Stripe
				// retry forever; log loudly and acknowledge instead.
				console.error(
					"deleted user's subscription could not be cancelled: STRIPE_SECRET_KEY unset",
					{ subscriptionId: parsed.subscriptionId }
				);
			} else if (
				(await cancelStripeSubscription(
					options.stripeFetch ?? fetch,
					stripeSecret,
					parsed.subscriptionId
				)) === "failed"
			) {
				return c.text("Unable to cancel Stripe subscription.", 500);
			}
		}
		// Mark the event processed so redelivery stays a no-op.
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
		tierRecomputeStatement(db, env, event.userId)
	];
	if (oldUserId !== undefined && oldUserId !== event.userId) {
		statements.push(tierRecomputeStatement(db, env, oldUserId));
	}
	await db.batch(statements);
}

// Recomputes a single user's tier from D1, the source of truth: `pro` iff an
// entitling subscription on a configured price OR a paid lifetime purchase on
// a configured lifetime price exists. Shared by the subscription and lifetime
// write paths so both notions of entitlement stay in one place.
function tierRecomputeStatement(
	db: D1Database,
	env: Env,
	userId: string
): D1PreparedStatement {
	const [monthlyPriceId, yearlyPriceId] = configuredPriceIds(env);
	const [lifetimePriceId, lifetimeLaunchPriceId] =
		configuredLifetimePriceIds(env);
	return db
		.prepare(
			`UPDATE users SET tier = CASE WHEN EXISTS (SELECT 1 FROM stripe_subscriptions WHERE user_id = ? AND status IN (${ENTITLING_STATUS_SQL}) AND price_id IN (?, ?)) OR EXISTS (SELECT 1 FROM stripe_lifetime_purchases WHERE user_id = ? AND status = 'paid' AND price_id IN (?, ?)) THEN 'pro' ELSE 'free' END WHERE id = ?`
		)
		.bind(
			userId,
			monthlyPriceId,
			yearlyPriceId,
			userId,
			lifetimePriceId,
			lifetimeLaunchPriceId,
			userId
		);
}

// Records a webhook event so redelivery of the same event id stays a no-op.
// Used by the lifetime handler's "not ours / unattributable / refunded"
// acknowledgements. The subscription path inlines its own equivalent.
async function recordWebhookEvent(
	db: D1Database,
	eventId: string,
	eventTimestamp: number
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO stripe_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
		)
		.bind(eventId, eventTimestamp, Date.now())
		.run();
}

// The write half of a completed Checkout session. Only lifetime payments we
// actually sell (mode=payment, paid, on a configured lifetime price) become a
// stripe_lifetime_purchases row; everything else is acknowledged so Stripe
// stops redelivering. Subscription checkouts are ignored here — they arrive as
// customer.subscription.* events.
async function handleCheckoutSessionCompleted(
	c: Context<{ Bindings: Env }>,
	rawEvent: Record<string, unknown>,
	object: Record<string, unknown> | null,
	options: StripeWebhookOptions
): Promise<Response> {
	// rawEvent.id and rawEvent.type were validated by the caller.
	const eventId = rawEvent.id as string;
	if (
		object === null ||
		typeof rawEvent.created !== "number" ||
		!Number.isSafeInteger(rawEvent.created) ||
		typeof object.id !== "string" ||
		object.id.length === 0
	) {
		return c.text("Invalid webhook payload.", 400);
	}
	const eventTimestamp = rawEvent.created;
	const sessionId = object.id;
	const mode = typeof object.mode === "string" ? object.mode : undefined;
	const paymentStatus =
		typeof object.payment_status === "string"
			? object.payment_status
			: undefined;
	const customer =
		typeof object.customer === "string" && object.customer.length > 0
			? object.customer
			: undefined;
	const paymentIntent =
		typeof object.payment_intent === "string" &&
		object.payment_intent.length > 0
			? object.payment_intent
			: undefined;
	const amountTotal =
		typeof object.amount_total === "number" ? object.amount_total : undefined;
	const metadata = isRecord(object.metadata) ? object.metadata : null;
	const metadataUserId =
		typeof metadata?.userId === "string" && metadata.userId.length > 0
			? metadata.userId
			: undefined;
	const priceId =
		typeof metadata?.priceId === "string" && metadata.priceId.length > 0
			? metadata.priceId
			: undefined;
	const clientReferenceId =
		typeof object.client_reference_id === "string" &&
		object.client_reference_id.length > 0
			? object.client_reference_id
			: undefined;

	// Not a lifetime purchase we sell. Subscription-mode checkouts and anything
	// unpaid or on an unrecognised price are acknowledged, not stored.
	if (
		mode !== "payment" ||
		paymentStatus !== "paid" ||
		priceId === undefined ||
		!configuredLifetimePriceIds(c.env).includes(priceId)
	) {
		await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
		return new Response(null, { status: 200 });
	}

	// Attribution: explicit metadata, then the client reference, then the
	// customer mapping we recorded at an earlier checkout.
	let userId = metadataUserId ?? clientReferenceId;
	if (userId === undefined && customer !== undefined) {
		const mapping = await c.env.DB.prepare(
			"SELECT user_id FROM stripe_customers WHERE customer_id = ?"
		)
			.bind(customer)
			.first<{ user_id: string }>();
		userId = mapping?.user_id;
	}
	if (userId === undefined) {
		await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
		return new Response(null, { status: 200 });
	}

	// A fully discounted session takes no payment, so Stripe creates no payment
	// intent and there is nothing to record against. Reachable only by a
	// 100%-off promotion code on the lifetime price, which we cannot honour:
	// the purchase row requires a payment intent. Acknowledge it — retrying
	// cannot change the outcome — and log loudly enough to entitle the buyer by
	// hand. See the promotional-codes note in the root README.
	if (paymentIntent === undefined && amountTotal === 0) {
		console.error(
			"Lifetime session was fully discounted, so it cannot be recorded. Entitle this user manually.",
			{ sessionId, userId }
		);
		await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
		return new Response(null, { status: 200 });
	}

	// Any other missing payment intent or customer is a malformed payload, not
	// a business case.
	if (paymentIntent === undefined || customer === undefined) {
		return c.text("Invalid webhook payload.", 400);
	}

	if (await isDeletedUser(c.env.DB, userId)) {
		// The account is gone but Checkout still took the money. Refund it and
		// never entitle anyone. On refund failure fail closed with a 500 and do
		// NOT record the event, so Stripe's retry re-runs this branch. A missing
		// key can't be fixed by retrying forever, so log loudly and acknowledge
		// instead (mirrors the subscription backstop above).
		const stripeSecret = c.env.STRIPE_SECRET_KEY;
		if (stripeSecret === undefined || stripeSecret.length === 0) {
			console.error(
				"deleted user's lifetime payment could not be refunded: STRIPE_SECRET_KEY unset",
				{ paymentIntentId: paymentIntent }
			);
			await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
			return new Response(null, { status: 200 });
		}
		if (
			(await refundStripePaymentIntent(
				options.stripeFetch ?? fetch,
				stripeSecret,
				paymentIntent
			)) === "failed"
		) {
			return c.text("Unable to refund Stripe payment.", 500);
		}
		await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
		return new Response(null, { status: 200 });
	}

	// Was this payment already refunded before we managed to record it? Only
	// reachable when the session event was retried for a while (a fail-closed
	// 500 below, or a webhook backlog) and the buyer got their money back in the
	// meantime: `charge.refunded` found no row to revoke and was acknowledged,
	// so nothing else would ever undo the entitlement. Checked BEFORE the
	// cancellation step — a refunded purchase must not end their subscription
	// either. Existing rows skip the lookup: a replayed event is the common case
	// and the row already tells us the outcome.
	const existingPurchase = await c.env.DB.prepare(
		"SELECT status FROM stripe_lifetime_purchases WHERE id = ?"
	)
		.bind(sessionId)
		.first<{ status: string }>();
	const purchaseSecret = c.env.STRIPE_SECRET_KEY;
	let purchaseStatus: "paid" | "refunded" = "paid";
	if (existingPurchase !== null) {
		purchaseStatus = existingPurchase.status === "refunded" ? "refunded" : "paid";
	} else if (purchaseSecret !== undefined && purchaseSecret.length > 0) {
		if (
			(await paymentIntentRefundState(
				options.stripeFetch ?? fetch,
				purchaseSecret,
				paymentIntent
			)) === "refunded"
		) {
			// Record it as refunded rather than dropping it: the money did move,
			// so the purchase belongs in the audit trail and in DSAR exports. Only
			// `paid` rows entitle, so this stays inert.
			console.error("Recording an already-refunded lifetime purchase.", {
				sessionId,
				paymentIntentId: paymentIntent
			});
			purchaseStatus = "refunded";
		}
	}

	// Upgrade path: a lifetime purchase supersedes any live subscription, so
	// stop every non-terminal one renewing BEFORE recording anything. Recording the
	// event first would neuter this fail-closed 500 — Stripe's retry would hit
	// the replay check and 200 without re-attempting the cancel. Cancellation
	// is idempotent, so the retry safely re-runs it.
	const liveSubscriptions = await c.env.DB.prepare(
		`SELECT id FROM stripe_subscriptions WHERE user_id = ? AND status NOT IN (${TERMINAL_STATUS_SQL})`
	)
		.bind(userId)
		.all<{ id: string }>();
	if (purchaseStatus === "paid" && liveSubscriptions.results.length > 0) {
		const stripeSecret = c.env.STRIPE_SECRET_KEY;
		if (stripeSecret === undefined || stripeSecret.length === 0) {
			// Don't block entitlement on our own config gap; log so we can
			// reconcile the stray subscription out of band.
			console.error(
				"lifetime upgrade could not cancel live subscriptions: STRIPE_SECRET_KEY unset",
				{ userId }
			);
		} else {
			for (const { id } of liveSubscriptions.results) {
				if (
					(await cancelStripeSubscription(
						options.stripeFetch ?? fetch,
						stripeSecret,
						id,
						// at_period_end, not immediate: the buyer already paid for
						// the rest of this month, and the lifetime row entitles
						// `pro` regardless, so letting the subscription lapse on
						// its own costs them nothing and charges them once.
						"at_period_end"
					)) === "failed"
				) {
					return c.text("Unable to cancel Stripe subscription.", 500);
				}
			}
		}
	}

	const nowMs = Date.now();
	const nowSeconds = Math.floor(nowMs / 1000);
	// Single batch, guarded like applySubscriptionEvent: a deletion committing
	// after the isDeletedUser fast path must not resurrect any row, so the
	// deleted_users guard is folded into every write.
	await c.env.DB.batch([
		c.env.DB.prepare(
			"INSERT INTO stripe_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
		).bind(eventId, eventTimestamp, nowMs),
		c.env.DB.prepare(
			"INSERT INTO users (id, tier, created_at) SELECT ?, 'free', ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (id) DO NOTHING"
		).bind(userId, nowSeconds, userId),
		c.env.DB.prepare(
			"INSERT INTO stripe_customers (user_id, customer_id, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (user_id) DO NOTHING"
		).bind(userId, customer, nowSeconds, userId),
		c.env.DB.prepare(
			"INSERT INTO stripe_lifetime_purchases (id, payment_intent_id, customer_id, price_id, user_id, status, event_timestamp, event_id) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (id) DO NOTHING"
		).bind(
			sessionId,
			paymentIntent,
			customer,
			priceId,
			userId,
			purchaseStatus,
			eventTimestamp,
			eventId,
			userId
		),
		tierRecomputeStatement(c.env.DB, c.env, userId)
	]);
	return new Response(null, { status: 200 });
}

// Revokes a lifetime purchase we refunded. The refunds policy grants a 14-day
// right on the lifetime purchase, and a refund issued from the Stripe
// dashboard is the only way that gets exercised — so the entitlement has to
// follow the money without anyone remembering to touch D1. Subscription
// invoice refunds land here too and are acknowledged: subscription
// entitlement already follows its own status.
async function handleChargeRefunded(
	c: Context<{ Bindings: Env }>,
	rawEvent: Record<string, unknown>,
	object: Record<string, unknown> | null
): Promise<Response> {
	// rawEvent.id and rawEvent.type were validated by the caller.
	const eventId = rawEvent.id as string;
	if (
		object === null ||
		typeof rawEvent.created !== "number" ||
		!Number.isSafeInteger(rawEvent.created) ||
		typeof object.id !== "string" ||
		object.id.length === 0
	) {
		return c.text("Invalid webhook payload.", 400);
	}
	const eventTimestamp = rawEvent.created;
	const paymentIntent =
		typeof object.payment_intent === "string" &&
		object.payment_intent.length > 0
			? object.payment_intent
			: undefined;
	// Only a full refund revokes First-Class. A partial refund (a tax
	// correction, a goodwill gesture) leaves the purchase standing: they still
	// bought it. `refunded` is Stripe's own flag; the amount comparison is a
	// belt-and-braces fallback for a payload that omits it.
	const amount = typeof object.amount === "number" ? object.amount : undefined;
	const amountRefunded =
		typeof object.amount_refunded === "number"
			? object.amount_refunded
			: undefined;
	const fullyRefunded =
		object.refunded === true ||
		(amount !== undefined &&
			amountRefunded !== undefined &&
			amount > 0 &&
			amountRefunded >= amount);
	if (paymentIntent === undefined || !fullyRefunded) {
		await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
		return new Response(null, { status: 200 });
	}

	const purchase = await c.env.DB.prepare(
		"SELECT user_id FROM stripe_lifetime_purchases WHERE payment_intent_id = ? AND status = 'paid' LIMIT 1"
	)
		.bind(paymentIntent)
		.first<{ user_id: string }>();
	if (purchase === null) {
		// A subscription invoice refund, the deleted-user backstop's own refund,
		// or a purchase already marked refunded. Nothing to revoke.
		await recordWebhookEvent(c.env.DB, eventId, eventTimestamp);
		return new Response(null, { status: 200 });
	}

	// The status = 'paid' guard makes the write idempotent on redelivery, and
	// the event row is inserted first in the same batch so the row's event_id
	// FK resolves.
	await c.env.DB.batch([
		c.env.DB.prepare(
			"INSERT INTO stripe_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
		).bind(eventId, eventTimestamp, Date.now()),
		c.env.DB.prepare(
			"UPDATE stripe_lifetime_purchases SET status = 'refunded', event_timestamp = ?, event_id = ? WHERE payment_intent_id = ? AND status = 'paid'"
		).bind(eventTimestamp, eventId, paymentIntent),
		tierRecomputeStatement(c.env.DB, c.env, purchase.user_id)
	]);
	return new Response(null, { status: 200 });
}
