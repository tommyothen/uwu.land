import type {
	BillingCheckoutRequest,
	BillingCheckoutResponse,
	BillingPortalResponse
} from "@uwu/shared";
import type { Context } from "hono";
import { z } from "zod";
import type { AuthOptions } from "./auth";
import {
	configuredPriceIds,
	ENTITLING_STATUS_SQL
} from "./billing-shared";
import { errorResponse } from "./errors";
import { isRecord, readJson, requireSession } from "./request-utils";
import type { Env } from "./worker";

const ACCOUNT_URL = "https://app.uwu.land/dashboard/account";
const STRIPE_API = "https://api.stripe.com/v1";
const checkoutSchema = z.object({
	cadence: z.enum(["monthly", "yearly"])
}).strict() satisfies z.ZodType<BillingCheckoutRequest>;

export interface BillingRouteOptions {
	auth?: AuthOptions;
	stripeFetch?: typeof fetch;
}

export async function createBillingCheckout(
	c: Context<{ Bindings: Env }>,
	options: BillingRouteOptions = {}
): Promise<Response> {
	const auth = await requireSession(
		c,
		options,
		"API keys cannot manage billing."
	);
	if (auth instanceof Response) {
		return auth;
	}

	const body = await readJson(c.req.raw);
	const parsed = checkoutSchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(400, "invalid_body", "Invalid request body.");
	}

	const [monthlyPriceId, yearlyPriceId] = configuredPriceIds(c.env);
	const subscription = await c.env.DB.prepare(
		`SELECT 1 FROM stripe_subscriptions WHERE user_id = ? AND status IN (${ENTITLING_STATUS_SQL}) AND price_id IN (?, ?) LIMIT 1`
	)
		.bind(auth.userId, monthlyPriceId, yearlyPriceId)
		.first();
	if (subscription !== null) {
		return errorResponse(
			409,
			"already_subscribed",
			"This account is already First-Class."
		);
	}

	const secret = c.env.STRIPE_SECRET_KEY;
	if (secret === undefined || secret.length === 0) {
		return stripeUnavailable();
	}
	const stripeFetch = options.stripeFetch ?? fetch;
	const customerId = await findOrCreateCustomer(
		c.env.DB,
		stripeFetch,
		secret,
		auth.userId
	);
	if (customerId === null) {
		return stripeUnavailable();
	}

	const priceId =
		parsed.data.cadence === "monthly" ? monthlyPriceId : yearlyPriceId;
	const params = new URLSearchParams({
		mode: "subscription",
		customer: customerId,
		"line_items[0][price]": priceId,
		"line_items[0][quantity]": "1",
		client_reference_id: auth.userId,
		"subscription_data[metadata][userId]": auth.userId,
		success_url: `${ACCOUNT_URL}?upgraded=1`,
		cancel_url: ACCOUNT_URL
	});
	const url = await createStripeSession(
		stripeFetch,
		`${STRIPE_API}/checkout/sessions`,
		secret,
		params
	);
	if (url === null) {
		return stripeUnavailable();
	}

	return Response.json({ url } satisfies BillingCheckoutResponse);
}

export async function createBillingPortal(
	c: Context<{ Bindings: Env }>,
	options: BillingRouteOptions = {}
): Promise<Response> {
	const auth = await requireSession(
		c,
		options,
		"API keys cannot manage billing."
	);
	if (auth instanceof Response) {
		return auth;
	}

	const customer = await c.env.DB.prepare(
		"SELECT customer_id FROM stripe_customers WHERE user_id = ?"
	)
		.bind(auth.userId)
		.first<{ customer_id: string }>();
	if (customer === null) {
		return errorResponse(404, "not_found", "Subscription not found.");
	}

	const secret = c.env.STRIPE_SECRET_KEY;
	if (secret === undefined || secret.length === 0) {
		return stripeUnavailable();
	}
	const url = await createStripeSession(
		options.stripeFetch ?? fetch,
		`${STRIPE_API}/billing_portal/sessions`,
		secret,
		new URLSearchParams({
			customer: customer.customer_id,
			return_url: ACCOUNT_URL
		})
	);
	if (url === null) {
		return stripeUnavailable();
	}

	return Response.json({ url } satisfies BillingPortalResponse);
}

async function findOrCreateCustomer(
	db: D1Database,
	stripeFetch: typeof fetch,
	secret: string,
	userId: string
): Promise<string | null> {
	const existing = await db
		.prepare("SELECT customer_id FROM stripe_customers WHERE user_id = ?")
		.bind(userId)
		.first<{ customer_id: string }>();
	if (existing !== null) {
		return existing.customer_id;
	}

	const customerId = await createStripeCustomer(
		stripeFetch,
		secret,
		userId
	);
	if (customerId === null) {
		return null;
	}
	await db
		.prepare(
			"INSERT INTO stripe_customers (user_id, customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING"
		)
		.bind(userId, customerId, Math.floor(Date.now() / 1000))
		.run();
	const stored = await db
		.prepare("SELECT customer_id FROM stripe_customers WHERE user_id = ?")
		.bind(userId)
		.first<{ customer_id: string }>();
	return stored?.customer_id ?? null;
}

async function createStripeCustomer(
	stripeFetch: typeof fetch,
	secret: string,
	userId: string
): Promise<string | null> {
	const url = `${STRIPE_API}/customers`;
	let response: Response;
	try {
		response = await stripeFetch(url, {
			method: "POST",
			headers: stripeHeaders(secret),
			body: new URLSearchParams({ "metadata[userId]": userId })
		});
	} catch {
		return null;
	}
	if (!response.ok) {
		await logStripeFailure(url, response);
		return null;
	}

	try {
		const payload: unknown = await response.json();
		return isRecord(payload) &&
			typeof payload.id === "string" &&
			payload.id.length > 0
			? payload.id
			: null;
	} catch {
		return null;
	}
}

async function createStripeSession(
	stripeFetch: typeof fetch,
	url: string,
	secret: string,
	body: URLSearchParams
): Promise<string | null> {
	let response: Response;
	try {
		response = await stripeFetch(url, {
			method: "POST",
			headers: stripeHeaders(secret),
			body
		});
	} catch {
		return null;
	}
	if (!response.ok) {
		await logStripeFailure(url, response);
		return null;
	}

	try {
		const payload: unknown = await response.json();
		return isRecord(payload) &&
			typeof payload.url === "string" &&
			payload.url.length > 0
			? payload.url
			: null;
	} catch {
		return null;
	}
}

function stripeHeaders(secret: string): HeadersInit {
	return {
		authorization: `Bearer ${secret}`,
		"content-type": "application/x-www-form-urlencoded"
	};
}

async function logStripeFailure(url: string, response: Response): Promise<void> {
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
		// The status and endpoint are still useful when Stripe sends non-JSON.
	}
	console.error("Stripe request failed.", {
		endpoint: new URL(url).pathname,
		status: response.status,
		type,
		code
	});
}

function stripeUnavailable(): Response {
	return errorResponse(
		502,
		"billing_unavailable",
		"Billing is temporarily unavailable."
	);
}
