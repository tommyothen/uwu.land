import { verifyWebhook } from "@clerk/backend/webhooks";
import type { Context } from "hono";
import { NON_TERMINAL_STATUS_SQL } from "./billing-shared";
import { isDeletedUser } from "./deletion";
import { emailIdentityHash } from "./identity";
import { isRecord, readJson } from "./request-utils";
import type { Env } from "./worker";

const RELEVANT_EVENT_TYPES = new Set([
	"user.created",
	"user.updated",
	"user.deleted"
]);

export const ACCOUNT_TOMBSTONE_WINDOW_SECONDS = 30 * 86_400;
const SEVEN_DAYS_SECONDS = 7 * 86_400;

export interface UserUpsertEvent {
	type: "user.created" | "user.updated";
	eventId: string;
	eventTimestamp: number;
	userId: string;
	email: string | null;
}

interface UserDeletedEvent {
	eventId: string;
	eventTimestamp: number;
	userId: string;
}

export interface ClerkWebhookOptions {
	stripeFetch?: typeof fetch;
}

export async function clerkWebhook(
	c: Context<{ Bindings: Env }>,
	options: ClerkWebhookOptions = {}
): Promise<Response> {
	const rawRequest = c.req.raw.clone();
	let verified: { type: string; data: unknown };
	let rawEvent: unknown;
	try {
		verified = await verifyWebhook(c.req.raw, {
			signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET
		});
		rawEvent = await readJson(rawRequest);
	} catch {
		return c.text("Invalid webhook signature.", 400);
	}

	if (!RELEVANT_EVENT_TYPES.has(verified.type)) {
		return new Response(null, { status: 200 });
	}

	const timestamp = isRecord(rawEvent) ? rawEvent.timestamp : null;
	const eventId = c.req.header("svix-id") ?? null;
	if (eventId !== null) {
		// Mirrors the Stripe webhook: an exact Svix redelivery of an already
		// processed event must not re-mutate (for example re-extend
		// limited_until). Out-of-order DISTINCT events remain best-effort; we
		// deliberately do not build per-user timestamp ordering here.
		const replay = await c.env.DB.prepare(
			"SELECT 1 FROM clerk_webhook_events WHERE id = ?"
		)
			.bind(eventId)
			.first();
		if (replay !== null) {
			return new Response(null, { status: 200 });
		}
	}
	if (verified.type === "user.created" || verified.type === "user.updated") {
		const event = parseUserUpsertEvent(verified, eventId, timestamp);
		if (event === null) {
			return c.text("Invalid user webhook payload.", 400);
		}
		await applyUserUpsertEvent(c.env.DB, event);
		return new Response(null, { status: 200 });
	}
	const event = parseUserDeletedEvent(verified, eventId, timestamp);
	if (event === null) {
		return c.text("Invalid user webhook payload.", 400);
	}
	if (
		!(await cancelUserSubscriptions(
			c.env.DB,
			options.stripeFetch ?? fetch,
			c.env.STRIPE_SECRET_KEY,
			event.userId
		))
	) {
		return c.text("Unable to cancel Stripe subscriptions.", 500);
	}
	const emailHash = await applyUserDeletedEvent(c.env.DB, event);
	await clearUserLimiterState(
		c.env.ENFORCEMENT,
		event.userId,
		emailHash
	);
	return new Response(null, { status: 200 });
}

export async function purgeExpiredAccountTombstones(
	db: D1Database,
	now = Date.now()
): Promise<void> {
	const cutoffSeconds =
		Math.floor(now / 1000) - ACCOUNT_TOMBSTONE_WINDOW_SECONDS;
	await db
		.prepare("DELETE FROM account_tombstones WHERE deleted_at < ?")
		.bind(cutoffSeconds)
		.run();
}

function parseUserUpsertEvent(
	event: { type: string; data: unknown },
	eventId: string | null,
	eventTimestamp: unknown
): UserUpsertEvent | null {
	if (
		!isRecord(event.data) ||
		eventId === null ||
		typeof eventTimestamp !== "number" ||
		!Number.isSafeInteger(eventTimestamp) ||
		typeof event.data.id !== "string" ||
		event.data.id.length === 0 ||
		!Array.isArray(event.data.email_addresses) ||
		(event.type !== "user.created" && event.type !== "user.updated")
	) {
		return null;
	}

	const emails = event.data.email_addresses.filter(
		(value): value is Record<string, unknown> =>
			isRecord(value) &&
			typeof value.id === "string" &&
			typeof value.email_address === "string"
	);
	const primaryId = event.data.primary_email_address_id;
	const primary =
		emails.find((email) => email.id === primaryId) ?? emails[0];

	return {
		type: event.type,
		eventId,
		eventTimestamp,
		userId: event.data.id,
		email:
			primary !== undefined && typeof primary.email_address === "string"
				? primary.email_address
				: null
	};
}

function parseUserDeletedEvent(
	event: { type: string; data: unknown },
	eventId: string | null,
	eventTimestamp: unknown
): UserDeletedEvent | null {
	if (
		event.type !== "user.deleted" ||
		!isRecord(event.data) ||
		eventId === null ||
		typeof eventTimestamp !== "number" ||
		!Number.isSafeInteger(eventTimestamp) ||
		typeof event.data.id !== "string" ||
		event.data.id.length === 0 ||
		event.data.deleted !== true
	) {
		return null;
	}

	return {
		eventId,
		eventTimestamp,
		userId: event.data.id
	};
}

async function applyUserUpsertEvent(
	db: D1Database,
	event: UserUpsertEvent
): Promise<void> {
	const nowMs = Date.now();
	const nowSeconds = Math.floor(nowMs / 1000);
	if (await isDeletedUser(db, event.userId)) {
		// A late or retried upsert must not resurrect a deleted account. Still
		// record the event so redelivery stays idempotent.
		await db
			.prepare(
				"INSERT INTO clerk_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, nowMs)
			.run();
		return;
	}
	const emailHash =
		event.email === null ? null : await emailIdentityHash(event.email);
	let shouldLimit = false;
	if (event.type === "user.created" && emailHash !== null) {
		const tombstones = await db
			.prepare(
				"SELECT COUNT(*) AS count FROM account_tombstones WHERE email_hash = ? AND deleted_at >= ?"
			)
			.bind(emailHash, nowSeconds - ACCOUNT_TOMBSTONE_WINDOW_SECONDS)
			.first<{ count: number }>();
		shouldLimit = (tombstones?.count ?? 0) >= 2;
	}

	await applyUserUpsertWrites(db, event, emailHash, shouldLimit, nowMs);
}

// The write half of a user upsert. A deletion can commit between the
// isDeletedUser fast path above and this batch, so every statement folds the
// deleted_users guard into itself: the write is atomic against that race and
// cannot resurrect a deleted account. Exported so the race test can run it
// with the deletion already committed.
export async function applyUserUpsertWrites(
	db: D1Database,
	event: UserUpsertEvent,
	emailHash: string | null,
	shouldLimit: boolean,
	nowMs: number
): Promise<void> {
	const nowSeconds = Math.floor(nowMs / 1000);
	const statements = [
		db
			.prepare(
				"INSERT INTO clerk_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, nowMs),
		db
			.prepare(
				"INSERT INTO users (id, tier, created_at, email_hash) SELECT ?, 'free', ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT(id) DO UPDATE SET email_hash = coalesce(excluded.email_hash, users.email_hash)"
			)
			.bind(event.userId, nowSeconds, emailHash, event.userId)
	];
	if (shouldLimit) {
		statements.push(
			db
				.prepare(
					"UPDATE users SET limited_until = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?)"
				)
				.bind(nowSeconds + SEVEN_DAYS_SECONDS, event.userId, event.userId)
		);
	}
	await db.batch(statements);
}

async function applyUserDeletedEvent(
	db: D1Database,
	event: UserDeletedEvent
): Promise<string | null> {
	const user = await db
		.prepare(
			`SELECT coalesce(
				(SELECT email_hash FROM users WHERE id = ?),
				(SELECT email_hash FROM account_tombstones WHERE event_id = ?)
			) AS email_hash`
		)
		.bind(event.userId, event.eventId)
		.first<{ email_hash: string | null }>();
	const nowMs = Date.now();
	const nowSeconds = Math.floor(nowMs / 1000);
	const statements = [
		db
			.prepare(
				"INSERT INTO clerk_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, nowMs),
		db
			.prepare(
				"UPDATE links SET owner_id = NULL, external_ref = NULL WHERE owner_id = ?"
			)
			.bind(event.userId),
		db.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(event.userId),
		db
			.prepare("DELETE FROM stripe_subscriptions WHERE user_id = ?")
			.bind(event.userId),
		db
			.prepare("DELETE FROM stripe_customers WHERE user_id = ?")
			.bind(event.userId),
		db.prepare("DELETE FROM users WHERE id = ?").bind(event.userId),
		db
			.prepare(
				"INSERT INTO deleted_users (user_id, deleted_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING"
			)
			.bind(event.userId, nowSeconds)
	];
	if (user?.email_hash != null) {
		statements.push(
			db
				.prepare(
					"INSERT INTO account_tombstones (event_id, email_hash, deleted_at) VALUES (?, ?, ?) ON CONFLICT (event_id) DO NOTHING"
				)
				.bind(event.eventId, user.email_hash, nowSeconds)
		);
	}
	await db.batch(statements);
	return user?.email_hash ?? null;
}

async function clearUserLimiterState(
	enforcement: DurableObjectNamespace<import("./enforcement").Enforcement>,
	userId: string,
	emailHash: string | null
): Promise<void> {
	const keys = new Set([`user:${userId}`]);
	if (emailHash !== null) {
		keys.add(`identity:${emailHash}`);
	}
	await Promise.all(
		[...keys].map(async (key) =>
			enforcement.getByName(key).clearStoredState()
		)
	);
}

async function cancelUserSubscriptions(
	db: D1Database,
	stripeFetch: typeof fetch,
	secret: string | undefined,
	userId: string
): Promise<boolean> {
	// Non-terminal, not just entitling: a paused/unpaid/incomplete
	// subscription must not outlive the account either, and it counts toward
	// the unset-secret fail-safe below.
	const subscriptions = await db
		.prepare(
			`SELECT id FROM stripe_subscriptions WHERE user_id = ? AND status IN (${NON_TERMINAL_STATUS_SQL})`
		)
		.bind(userId)
		.all<{ id: string }>();
	if (secret === undefined || secret.length === 0) {
		if (subscriptions.results.length === 0) {
			return true;
		}
		console.error(
			"STRIPE_SECRET_KEY is unset; cannot cancel subscriptions for deleted user."
		);
		return false;
	}

	for (const subscription of subscriptions.results) {
		const url = `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.id)}`;
		let response: Response;
		try {
			response = await stripeFetch(url, {
				method: "DELETE",
				headers: { authorization: `Bearer ${secret}` }
			});
		} catch {
			console.error("Stripe subscription cancellation failed.", {
				endpoint: new URL(url).pathname
			});
			return false;
		}
		if (response.ok || response.status === 404) {
			continue;
		}

		let type: string | undefined;
		let code: string | undefined;
		try {
			const payload: unknown = await response.json();
			if (isRecord(payload) && isRecord(payload.error)) {
				type =
					typeof payload.error.type === "string"
						? payload.error.type
						: undefined;
				code =
					typeof payload.error.code === "string"
						? payload.error.code
						: undefined;
			}
		} catch {
			// Status and endpoint still identify the failed Stripe operation.
		}
		if (code === "resource_missing") {
			continue;
		}
		console.error("Stripe subscription cancellation failed.", {
			endpoint: new URL(url).pathname,
			status: response.status,
			type,
			code
		});
		return false;
	}
	return true;
}
