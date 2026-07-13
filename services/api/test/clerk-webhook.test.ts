import { createExecutionContext, env } from "cloudflare:test";
import {
	accountTombstones,
	apiKeys,
	stripeSubscriptions,
	stripeWebhookEvents,
	users
} from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailIdentityHash } from "../src/identity";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import { createApp } from "../src/worker";
import { resetD1 } from "./helpers/d1";

const WEBHOOK_SECRET = "whsec_dGVzdC1jbGVyay13ZWJob29rLXNlY3JldA==";
const WEBHOOK_URL = "https://uwu.land/webhooks/clerk";

interface ClerkPayload {
	type: string;
	timestamp?: number;
	data: {
		id?: string;
		deleted?: boolean;
		email_addresses?: Array<{ id: string; email_address: string }>;
		primary_email_address_id?: string;
	};
}

const testEnv: Env = {
	UWU: env.UWU,
	CLICKS: env.CLICKS,
	CLICK_EVENTS: env.CLICK_EVENTS,
	DB: env.DB,
	ENFORCEMENT: env.ENFORCEMENT,
	CLERK_ISSUER: env.CLERK_ISSUER,
	STRIPE_PRICE_ID_MONTHLY: env.STRIPE_PRICE_ID_MONTHLY,
	STRIPE_PRICE_ID_YEARLY: env.STRIPE_PRICE_ID_YEARLY,
	STRIPE_SECRET_KEY: "sk_test_clerk_delete",
	CLERK_WEBHOOK_SIGNING_SECRET: WEBHOOK_SECRET
};

beforeEach(async () => {
	await resetD1(env.DB);
});

describe("Clerk user webhook", () => {
	it("stores the normalized primary email identity on user creation", async () => {
		await sendWebhook(userUpsertPayload("user.created", "user_identity", [
			{ id: "email_secondary", email_address: "other@example.com" },
			{ id: "email_primary", email_address: "Foo+bar@GMAIL.com" }
		], "email_primary"));

		expect((await findUser("user_identity"))?.emailHash).toBe(
			await emailIdentityHash("f.o.o@gmail.com")
		);
	});

	it("keeps the stored email identity when an update carries no email", async () => {
		await sendWebhook(userUpsertPayload("user.created", "user_identity", [
			{ id: "email_primary", email_address: "keep@example.com" }
		], "email_primary"));

		await sendWebhook(
			userUpsertPayload("user.updated", "user_identity", [], "email_primary"),
			{ id: "msg_no_email_update" }
		);

		expect((await findUser("user_identity"))?.emailHash).toBe(
			await emailIdentityHash("keep@example.com")
		);
	});

	it("revokes active keys, writes one tombstone, and keeps the user on redelivery", async () => {
		const emailHash = await emailIdentityHash("deleted@example.com");
		await drizzle(env.DB)
			.insert(users)
			.values({ id: "user_deleted", emailHash })
			.run();
		await drizzle(env.DB)
			.insert(apiKeys)
			.values([
				{
					id: "key_active_one",
					userId: "user_deleted",
					name: "Active one",
					keyHash: await hashKey("uwu_deleted_one"),
					displayPrefix: "uwu_deleted_"
				},
				{
					id: "key_active_two",
					userId: "user_deleted",
					name: "Active two",
					keyHash: await hashKey("uwu_deleted_two"),
					displayPrefix: "uwu_deleted_"
				},
				{
					id: "key_already_revoked",
					userId: "user_deleted",
					name: "Already revoked",
					keyHash: await hashKey("uwu_deleted_old"),
					displayPrefix: "uwu_deleted_",
					revokedAt: new Date("2026-01-01T00:00:00.000Z")
				}
			])
			.run();
		const payload = userDeletedPayload("user_deleted");

		await sendWebhook(payload, { id: "msg_user_deleted" });
		await sendWebhook(payload, { id: "msg_user_deleted" });

		const keys = await drizzle(env.DB).select().from(apiKeys).all();
		expect(keys.find(({ id }) => id === "key_active_one")?.revokedAt).not.toBeNull();
		expect(keys.find(({ id }) => id === "key_active_two")?.revokedAt).not.toBeNull();
		expect(
			keys.find(({ id }) => id === "key_already_revoked")?.revokedAt
		).toEqual(new Date("2026-01-01T00:00:00.000Z"));
		expect(await drizzle(env.DB).select().from(accountTombstones).all()).toMatchObject([
			{ eventId: "msg_user_deleted", emailHash }
		]);
		expect(await findUser("user_deleted")).toBeDefined();
		expect((await findUser("user_deleted"))?.tier).toBe("free");
	});

	it("cancels tracked entitling subscriptions when a user is deleted", async () => {
		await seedSubscription("user_subscribed", "sub_delete_me");
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ status: "canceled" })
		);

		const response = await sendWebhook(userDeletedPayload("user_subscribed"), {
			stripeFetch
		});

		expect(response.status).toBe(200);
		expect(stripeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = stripeFetch.mock.calls[0] ?? [];
		expect(url).toBe(
			"https://api.stripe.com/v1/subscriptions/sub_delete_me"
		);
		expect(init?.method).toBe("DELETE");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer sk_test_clerk_delete"
		);
		expect(await findTier("user_subscribed")).toBe("free");
	});

	it("returns 500 when Stripe subscription cancellation fails", async () => {
		await seedSubscription("user_cancel_failure", "sub_cancel_failure");
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: { type: "api_error", code: "api_error" } },
				{ status: 500 }
			)
		);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await sendWebhook(
			userDeletedPayload("user_cancel_failure"),
			{ stripeFetch }
		);

		expect(response.status).toBe(500);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("treats Stripe resource_missing as an idempotent cancellation", async () => {
		await seedSubscription("user_already_canceled", "sub_already_canceled");
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: { type: "invalid_request_error", code: "resource_missing" } },
				{ status: 404 }
			)
		);

		const response = await sendWebhook(
			userDeletedPayload("user_already_canceled"),
			{ stripeFetch }
		);

		expect(response.status).toBe(200);
	});

	it("skips Stripe cancellation when the secret is unset", async () => {
		await seedSubscription("user_no_secret", "sub_no_secret");
		const stripeFetch = vi.fn<typeof fetch>();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await sendWebhook(userDeletedPayload("user_no_secret"), {
			stripeFetch,
			envOverride: { STRIPE_SECRET_KEY: undefined }
		});

		expect(response.status).toBe(200);
		expect(stripeFetch).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("limits a recreated identity after two recent tombstones", async () => {
		const email = "repeat@example.com";
		const emailHash = await emailIdentityHash(email);
		const now = Date.now();
		await drizzle(env.DB)
			.insert(accountTombstones)
			.values([
				{ eventId: "delete_recent_one", emailHash, deletedAt: new Date(now - 1_000) },
				{ eventId: "delete_recent_two", emailHash, deletedAt: new Date(now - 2_000) }
			])
			.run();

		await sendWebhook(userUpsertPayload("user.created", "user_repeat", [
			{ id: "email_repeat", email_address: email }
		], "email_repeat"));

		const limitedUntil = (await findUser("user_repeat"))?.limitedUntil;
		expect(limitedUntil).not.toBeNull();
		expect(limitedUntil?.getTime()).toBeGreaterThanOrEqual(
			now + 7 * 86_400_000 - 1_000
		);
	});

	it("does not limit a recreation for a single tombstone older than 30 days", async () => {
		const email = "old-delete@example.com";
		const emailHash = await emailIdentityHash(email);
		await drizzle(env.DB)
			.insert(accountTombstones)
			.values({
				eventId: "delete_old",
				emailHash,
				deletedAt: new Date(Date.now() - 31 * 86_400_000)
			})
			.run();

		await sendWebhook(userUpsertPayload("user.created", "user_old_delete", [
			{ id: "email_old", email_address: email }
		], "email_old"));

		expect((await findUser("user_old_delete"))?.limitedUntil).toBeNull();
	});
});

function userUpsertPayload(
	type: "user.created" | "user.updated",
	userId: string,
	emailAddresses: Array<{ id: string; email_address: string }>,
	primaryEmailAddressId: string
): ClerkPayload {
	return {
		type,
		timestamp: 100,
		data: {
			id: userId,
			email_addresses: emailAddresses,
			primary_email_address_id: primaryEmailAddressId
		}
	};
}

function userDeletedPayload(userId: string): ClerkPayload {
	return {
		type: "user.deleted",
		timestamp: 100,
		data: { id: userId, deleted: true }
	};
}

async function sendWebhook(
	payload: ClerkPayload,
	options: {
		timestamp?: number;
		id?: string;
		stripeFetch?: typeof fetch;
		envOverride?: Partial<Env>;
	} = {}
): Promise<Response> {
	const app = createApp({ stripeFetch: options.stripeFetch });
	return app.fetch(
		await signedRequest(payload, options),
		{ ...testEnv, ...options.envOverride },
		createExecutionContext()
	);
}

async function signedRequest(
	payload: ClerkPayload,
	options: { timestamp?: number; id?: string } = {}
): Promise<Request> {
	const body = JSON.stringify(payload);
	const id = options.id ?? `msg_${crypto.randomUUID()}`;
	const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
	const signature = await signSvix(`${id}.${timestamp}.${body}`);

	return new Request(WEBHOOK_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"svix-id": id,
			"svix-timestamp": timestamp.toString(),
			"svix-signature": `v1,${signature}`
		},
		body
	});
}

async function signSvix(value: string): Promise<string> {
	const secret = decodeBase64(WEBHOOK_SECRET.slice("whsec_".length));
	const key = await crypto.subtle.importKey(
		"raw",
		secret,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value)
	);
	return encodeBase64(new Uint8Array(signature));
}

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
	return btoa(String.fromCharCode(...value));
}

async function findUser(id: string) {
	const [user] = await drizzle(env.DB)
		.select()
		.from(users)
		.where(eq(users.id, id))
		.limit(1)
		.all();
	return user;
}

async function findTier(id: string): Promise<"free" | "pro" | undefined> {
	return (await findUser(id))?.tier;
}

async function seedSubscription(userId: string, subscriptionId: string) {
	const db = drizzle(env.DB);
	await db.insert(users).values({ id: userId, tier: "pro" }).run();
	await db.insert(stripeWebhookEvents)
		.values({ id: `evt_${subscriptionId}`, eventTimestamp: 100 })
		.run();
	await db.insert(stripeSubscriptions)
		.values({
			id: subscriptionId,
			customerId: `cus_${userId}`,
			priceId: "price_any",
			userId,
			status: "active",
			eventTimestamp: 100,
			eventId: `evt_${subscriptionId}`
		})
		.run();
}
