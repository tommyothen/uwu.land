import { verifyWebhook } from "@clerk/backend/webhooks";
import type { Context } from "hono";
import { ENTITLING_STATUS_SQL } from "./billing-shared";
import { emailIdentityHash } from "./identity";
import { isRecord, readJson } from "./request-utils";
import type { Env } from "./worker";

const RELEVANT_EVENT_TYPES = new Set([
	"user.created",
	"user.updated",
	"user.deleted"
]);

const THIRTY_DAYS_SECONDS = 30 * 86_400;
const SEVEN_DAYS_SECONDS = 7 * 86_400;

interface UserUpsertEvent {
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
	await applyUserDeletedEvent(c.env.DB, event);
	return new Response(null, { status: 200 });
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
	const emailHash =
		event.email === null ? null : await emailIdentityHash(event.email);
	let shouldLimit = false;
	if (event.type === "user.created" && emailHash !== null) {
		const tombstones = await db
			.prepare(
				"SELECT COUNT(*) AS count FROM account_tombstones WHERE email_hash = ? AND deleted_at >= ?"
			)
			.bind(emailHash, nowSeconds - THIRTY_DAYS_SECONDS)
			.first<{ count: number }>();
		shouldLimit = (tombstones?.count ?? 0) >= 2;
	}

	const statements = [
		db
			.prepare(
				"INSERT INTO clerk_webhook_events (id, event_timestamp, processed_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING"
			)
			.bind(event.eventId, event.eventTimestamp, nowMs),
		db
			.prepare(
				"INSERT INTO users (id, tier, created_at, email_hash) VALUES (?, 'free', ?, ?) ON CONFLICT(id) DO UPDATE SET email_hash = coalesce(excluded.email_hash, users.email_hash)"
			)
			.bind(event.userId, nowSeconds, emailHash)
	];
	if (shouldLimit) {
		statements.push(
			db
				.prepare("UPDATE users SET limited_until = ? WHERE id = ?")
				.bind(nowSeconds + SEVEN_DAYS_SECONDS, event.userId)
		);
	}
	await db.batch(statements);
}

async function applyUserDeletedEvent(
	db: D1Database,
	event: UserDeletedEvent
): Promise<void> {
	const user = await db
		.prepare("SELECT email_hash FROM users WHERE id = ?")
		.bind(event.userId)
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
				"UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
			)
			.bind(nowSeconds, event.userId),
		db
			.prepare("UPDATE users SET tier = 'free' WHERE id = ?")
			.bind(event.userId)
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
}

async function cancelUserSubscriptions(
	db: D1Database,
	stripeFetch: typeof fetch,
	secret: string | undefined,
	userId: string
): Promise<boolean> {
	if (secret === undefined || secret.length === 0) {
		console.error(
			"STRIPE_SECRET_KEY is unset; skipping subscription cancellation for deleted user."
		);
		return true;
	}

	const subscriptions = await db
		.prepare(
			`SELECT id FROM stripe_subscriptions WHERE user_id = ? AND status IN (${ENTITLING_STATUS_SQL})`
		)
		.bind(userId)
		.all<{ id: string }>();
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
