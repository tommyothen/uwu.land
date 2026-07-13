import { createExecutionContext, env } from "cloudflare:test";
import {
	apiKeys,
	stripeSubscriptions,
	stripeWebhookEvents,
	users
} from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestJwks } from "../src/auth";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import { createWorker } from "../src/worker";
import { resetD1 } from "./helpers/d1";

type TestFetch = (
	request: Request,
	env: Env,
	ctx: ExecutionContext
) => Promise<Response>;

const issuer = "https://clerk.test";
const testEnv = {
	...env,
	STRIPE_SECRET_KEY: "sk_test_uwu"
} as Env;
let jwt: string;
let jwks: TestJwks;

beforeAll(async () => {
	({ jwt, jwks } = await createJwt("user_billing"));
});

beforeEach(async () => {
	await resetD1(env.DB);
});

describe("Stripe billing routes", () => {
	it("rejects anonymous callers", async () => {
		const response = await workerFetch(
			new Request("https://uwu.land/api/v1/billing/checkout", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cadence: "monthly" })
			})
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ code: "unauthorized" });
	});

	it("rejects API-key callers", async () => {
		const secret = "uwu_billingApiKey00000000000000000";
		const db = drizzle(env.DB);
		await db.insert(users).values({ id: "user_key" }).run();
		await db.insert(apiKeys)
			.values({
				id: "key_billing",
				userId: "user_key",
				name: "Billing key",
				keyHash: await hashKey(secret),
				displayPrefix: secret.slice(0, 12)
			})
			.run();

		const response = await workerFetch(
			billingRequest("/checkout", secret, { cadence: "monthly" })
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({ code: "forbidden" });
	});

	it("creates a monthly Checkout Session with the expected Stripe form", async () => {
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ url: "https://checkout.stripe.com/c/pay_test" })
		);

		const response = await workerFetch(
			billingRequest("/checkout", jwt, { cadence: "monthly" }),
			stripeFetch
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			url: "https://checkout.stripe.com/c/pay_test"
		});
		expect(stripeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = stripeFetch.mock.calls[0] ?? [];
		expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer sk_test_uwu"
		);
		const form = new URLSearchParams(String(init?.body));
		expect(form.get("mode")).toBe("subscription");
		expect(form.get("line_items[0][price]")).toBe(
			env.STRIPE_PRICE_ID_MONTHLY
		);
		expect(form.get("line_items[0][quantity]")).toBe("1");
		expect(form.get("client_reference_id")).toBe("user_billing");
		expect(form.get("subscription_data[metadata][userId]")).toBe(
			"user_billing"
		);
		expect(form.get("success_url")).toBe(
			"https://app.uwu.land/dashboard/account?upgraded=1"
		);
	});

	it("rejects an invalid cadence", async () => {
		const stripeFetch = vi.fn<typeof fetch>();

		const response = await workerFetch(
			billingRequest("/checkout", jwt, { cadence: "weekly" }),
			stripeFetch
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ code: "invalid_body" });
		expect(stripeFetch).not.toHaveBeenCalled();
	});

	it("rejects checkout when the user is already pro", async () => {
		await drizzle(env.DB)
			.insert(users)
			.values({ id: "user_billing", tier: "pro" })
			.run();
		const stripeFetch = vi.fn<typeof fetch>();

		const response = await workerFetch(
			billingRequest("/checkout", jwt, { cadence: "yearly" }),
			stripeFetch
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			code: "already_subscribed"
		});
		expect(stripeFetch).not.toHaveBeenCalled();
	});

	it("creates a Billing Portal Session for the preferred subscription customer", async () => {
		const db = drizzle(env.DB);
		await db.insert(users).values({ id: "user_billing", tier: "pro" }).run();
		await db.insert(stripeWebhookEvents)
			.values([
				{ id: "evt_active", eventTimestamp: 100 },
				{ id: "evt_canceled", eventTimestamp: 200 }
			])
			.run();
		await db.insert(stripeSubscriptions)
			.values([
				{
					id: "sub_active",
					customerId: "cus_active",
					userId: "user_billing",
					status: "active",
					eventTimestamp: 100,
					eventId: "evt_active"
				},
				{
					id: "sub_canceled",
					customerId: "cus_newer_canceled",
					userId: "user_billing",
					status: "canceled",
					eventTimestamp: 200,
					eventId: "evt_canceled"
				}
			])
			.run();
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json({ url: "https://billing.stripe.com/p/session_test" })
		);

		const response = await workerFetch(
			billingRequest("/portal", jwt),
			stripeFetch
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			url: "https://billing.stripe.com/p/session_test"
		});
		const [, init] = stripeFetch.mock.calls[0] ?? [];
		const form = new URLSearchParams(String(init?.body));
		expect(form.get("customer")).toBe("cus_active");
		expect(form.get("return_url")).toBe(
			"https://app.uwu.land/dashboard/account"
		);
	});

	it("returns 404 when the user has no Stripe subscription", async () => {
		const stripeFetch = vi.fn<typeof fetch>();

		const response = await workerFetch(
			billingRequest("/portal", jwt),
			stripeFetch
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
		expect(stripeFetch).not.toHaveBeenCalled();
	});

	it("maps Stripe failures to a 502 without leaking the upstream body", async () => {
		const stripeFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: { message: "sensitive Stripe account detail" } },
				{ status: 500 }
			)
		);

		const response = await workerFetch(
			billingRequest("/checkout", jwt, { cadence: "yearly" }),
			stripeFetch
		);
		const body = await response.json<{ code: string; message: string }>();

		expect(response.status).toBe(502);
		expect(body.code).toBe("billing_unavailable");
		expect(body.message).not.toContain("Stripe account detail");
	});
});

async function workerFetch(
	request: Request,
	stripeFetch?: typeof fetch
): Promise<Response> {
	const worker = createWorker({
		auth: { clerkIssuer: issuer, jwks },
		stripeFetch
	});
	return (worker.fetch as TestFetch)(request, testEnv, createExecutionContext());
}

function billingRequest(path: string, token: string, body?: unknown): Request {
	const headers = new Headers({ authorization: `Bearer ${token}` });
	if (body !== undefined) {
		headers.set("content-type", "application/json");
	}
	return new Request(`https://uwu.land/api/v1/billing${path}`, {
		method: "POST",
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function createJwt(userId: string): Promise<{
	jwt: string;
	jwks: TestJwks;
}> {
	const keyPair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256"
		},
		true,
		["sign", "verify"]
	)) as CryptoKeyPair;
	const kid = "billing-test-key";
	const publicJwk = (await crypto.subtle.exportKey(
		"jwk",
		keyPair.publicKey
	)) as JsonWebKey & { kid?: string; alg?: string; use?: string };
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", kid, typ: "JWT" };
	const payload = {
		aud: "uwu-land",
		exp: now + 300,
		iat: now,
		iss: issuer,
		nbf: now - 5,
		sub: userId
	};
	const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		keyPair.privateKey,
		new TextEncoder().encode(signingInput)
	);
	return {
		jwt: `${signingInput}.${base64Url(new Uint8Array(signature))}`,
		jwks: {
			keys: [{ ...publicJwk, alg: "RS256", kid, use: "sig" }]
		}
	};
}

function base64UrlJson(value: unknown): string {
	return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}
