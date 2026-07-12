import { createExecutionContext, env } from "cloudflare:test";
import { accountTombstones, apiKeys, users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { emailIdentityHash } from "../src/identity";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import { createApp } from "../src/worker";
import { resetD1 } from "./helpers/d1";

const WEBHOOK_SECRET = "whsec_dGVzdC1jbGVyay13ZWJob29rLXNlY3JldA==";
const WEBHOOK_URL = "https://uwu.land/webhooks/clerk";

interface BillingPayload {
	type: string;
	timestamp?: number;
	data: {
		id?: string;
		deleted?: boolean;
		email_addresses?: Array<{ id: string; email_address: string }>;
		primary_email_address_id?: string;
		object?: string;
		status?: string;
		payer?: { user_id?: string };
		plan?: { slug?: string };
	};
}

const app = createApp();
const testEnv: Env = {
	UWU: env.UWU,
	CLICKS: env.CLICKS,
	CLICK_EVENTS: env.CLICK_EVENTS,
	DB: env.DB,
	ENFORCEMENT: env.ENFORCEMENT,
	CLERK_ISSUER: env.CLERK_ISSUER,
	CLERK_WEBHOOK_SIGNING_SECRET: WEBHOOK_SECRET
};

beforeEach(async () => {
	await resetD1(env.DB);
});

describe("Clerk billing webhook", () => {
	it("sets an existing first_class subscriber to pro", async () => {
		await seedUser("user_existing", "free");

		const response = await sendWebhook(activePayload("user_existing"));

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect((await findUser("user_existing"))?.tier).toBe("pro");
	});

	it("creates an unknown first_class subscriber with the pro tier", async () => {
		const response = await sendWebhook(activePayload("user_new"));

		expect(response.status).toBe(200);
		expect(await findUser("user_new")).toMatchObject({
			id: "user_new",
			tier: "pro"
		});
	});

	it("sets a first_class subscriber to free when their subscription ends", async () => {
		await seedUser("user_ended", "pro");

		await sendWebhook(activePayload("user_ended", "subi_ended", 100));
		const response = await sendWebhook(
			itemPayload("subscriptionItem.ended", "user_ended", "subi_ended", 200)
		);

		expect(response.status).toBe(200);
		expect((await findUser("user_ended"))?.tier).toBe("free");
	});

	it("does not change a canceled first_class subscription", async () => {
		await seedUser("user_canceled", "pro");

		await sendWebhook(activePayload("user_canceled", "subi_canceled", 100));
		const response = await sendWebhook(
			itemPayload(
				"subscriptionItem.canceled",
				"user_canceled",
				"subi_canceled",
				200
			)
		);

		expect(response.status).toBe(200);
		expect((await findUser("user_canceled"))?.tier).toBe("pro");
	});

	it("ignores billing events for other plans", async () => {
		await seedUser("user_other_plan", "free");

		const response = await sendWebhook(
			itemPayload(
				"subscriptionItem.active",
				"user_other_plan",
				"subi_other",
				100,
				"other_plan"
			)
		);

		expect(response.status).toBe(200);
		expect((await findUser("user_other_plan"))?.tier).toBe("free");
	});

	it("rejects an invalid signature without changing the database", async () => {
		await seedUser("user_bad_signature", "free");
		const request = await signedRequest(activePayload("user_bad_signature"));
		request.headers.set("svix-signature", "v1,not-a-valid-signature");

		const response = await app.fetch(request, testEnv, createExecutionContext());

		expect(response.status).toBe(400);
		expect((await findUser("user_bad_signature"))?.tier).toBe("free");
	});

	it("rejects a stale Svix timestamp", async () => {
		await seedUser("user_stale", "free");

		const response = await sendWebhook(activePayload("user_stale"), {
			timestamp: Math.floor(Date.now() / 1000) - 301
		});

		expect(response.status).toBe(400);
		expect((await findUser("user_stale"))?.tier).toBe("free");
	});

	it("ignores a duplicate delivery", async () => {
		const payload = activePayload("user_duplicate", "subi_duplicate", 100);

		await sendWebhook(payload, { id: "msg_duplicate" });
		await sendWebhook(payload, { id: "msg_duplicate" });

		expect((await findUser("user_duplicate"))?.tier).toBe("pro");
		const count = await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM clerk_webhook_events WHERE id = ?"
		)
			.bind("msg_duplicate")
			.first<{ count: number }>();
		expect(count?.count).toBe(1);
	});

	it("ignores an older ended event delivered after active", async () => {
		await sendWebhook(activePayload("user_ordered", "subi_ordered", 200));
		await sendWebhook(
			itemPayload("subscriptionItem.ended", "user_ordered", "subi_ordered", 100)
		);

		expect((await findUser("user_ordered"))?.tier).toBe("pro");
	});

	it("keeps pro while another first_class item remains active", async () => {
		await sendWebhook(activePayload("user_multiple", "subi_one", 100));
		await sendWebhook(activePayload("user_multiple", "subi_two", 110));
		await sendWebhook(
			itemPayload("subscriptionItem.ended", "user_multiple", "subi_one", 200)
		);

		expect((await findUser("user_multiple"))?.tier).toBe("pro");
	});

	it("sets free after the final first_class item ends", async () => {
		await sendWebhook(activePayload("user_final", "subi_one", 100));
		await sendWebhook(activePayload("user_final", "subi_two", 110));
		await sendWebhook(
			itemPayload("subscriptionItem.ended", "user_final", "subi_one", 200)
		);
		await sendWebhook(
			itemPayload("subscriptionItem.ended", "user_final", "subi_two", 210)
		);

		expect((await findUser("user_final"))?.tier).toBe("free");
	});

	it("rejects a malformed relevant event", async () => {
		await seedUser("user_malformed", "free");
		const payload = activePayload("user_malformed", "subi_malformed", 100);
		delete payload.data.id;

		const response = await sendWebhook(payload);

		expect(response.status).toBe(400);
		expect((await findUser("user_malformed"))?.tier).toBe("free");
	});

	it("acknowledges an unknown event without mutation", async () => {
		await seedUser("user_unknown", "free");

		const response = await sendWebhook({
			type: "paymentAttempt.created",
			timestamp: 100,
			data: { payer: { user_id: "user_unknown" } }
		});

		expect(response.status).toBe(200);
		expect((await findUser("user_unknown"))?.tier).toBe("free");
	});
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

function activePayload(
	userId: string,
	itemId = `subi_${userId}`,
	timestamp = 100
): BillingPayload {
	return itemPayload("subscriptionItem.active", userId, itemId, timestamp);
}

function itemPayload(
	type: string,
	userId: string,
	itemId: string,
	timestamp: number,
	planSlug = "first_class"
): BillingPayload {
	const status = type.slice("subscriptionItem.".length);
	return {
		type,
		timestamp,
		data: {
			id: itemId,
			object: "commerce_subscription_item",
			status,
			payer: { user_id: userId },
			plan: { slug: planSlug }
		}
	};
}

function userUpsertPayload(
	type: "user.created" | "user.updated",
	userId: string,
	emailAddresses: Array<{ id: string; email_address: string }>,
	primaryEmailAddressId: string
): BillingPayload {
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

function userDeletedPayload(userId: string): BillingPayload {
	return {
		type: "user.deleted",
		timestamp: 100,
		data: { id: userId, deleted: true }
	};
}

async function sendWebhook(
	payload: BillingPayload,
	options: { timestamp?: number; id?: string } = {}
): Promise<Response> {
	return app.fetch(
		await signedRequest(payload, options),
		testEnv,
		createExecutionContext()
	);
}

async function signedRequest(
	payload: BillingPayload,
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

async function seedUser(id: string, tier: "free" | "pro"): Promise<void> {
	await drizzle(env.DB).insert(users).values({ id, tier }).run();
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
