import { createExecutionContext, env } from "cloudflare:test";
import { users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/worker";
import { createApp } from "../src/worker";

const WEBHOOK_SECRET = "whsec_dGVzdC1jbGVyay13ZWJob29rLXNlY3JldA==";
const WEBHOOK_URL = "https://uwu.land/webhooks/clerk";

interface BillingPayload {
	type: string;
	data: {
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
	await env.DB
		.prepare(
			`CREATE TABLE IF NOT EXISTS users (
				id text PRIMARY KEY NOT NULL,
				tier text DEFAULT 'free' NOT NULL,
				created_at integer NOT NULL
			)`
		)
		.run();
	await env.DB.prepare("DELETE FROM users").run();
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

		const response = await sendWebhook({
			type: "subscriptionItem.ended",
			data: { payer: { user_id: "user_ended" }, plan: { slug: "first_class" } }
		});

		expect(response.status).toBe(200);
		expect((await findUser("user_ended"))?.tier).toBe("free");
	});

	it("does not change a canceled first_class subscription", async () => {
		await seedUser("user_canceled", "pro");

		const response = await sendWebhook({
			type: "subscriptionItem.canceled",
			data: {
				payer: { user_id: "user_canceled" },
				plan: { slug: "first_class" }
			}
		});

		expect(response.status).toBe(200);
		expect((await findUser("user_canceled"))?.tier).toBe("pro");
	});

	it("ignores billing events for other plans", async () => {
		await seedUser("user_other_plan", "free");

		const response = await sendWebhook({
			type: "subscriptionItem.active",
			data: {
				payer: { user_id: "user_other_plan" },
				plan: { slug: "other_plan" }
			}
		});

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
});

function activePayload(userId: string): BillingPayload {
	return {
		type: "subscriptionItem.active",
		data: { payer: { user_id: userId }, plan: { slug: "first_class" } }
	};
}

async function sendWebhook(
	payload: BillingPayload,
	options: { timestamp?: number } = {}
): Promise<Response> {
	return app.fetch(
		await signedRequest(payload, options),
		testEnv,
		createExecutionContext()
	);
}

async function signedRequest(
	payload: BillingPayload,
	options: { timestamp?: number } = {}
): Promise<Request> {
	const body = JSON.stringify(payload);
	const id = "msg_test_123";
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
