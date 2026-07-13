import type {
	BillingCheckoutRequest,
	BillingCheckoutResponse,
	BillingPortalResponse
} from "@uwu/shared";
import type { Context } from "hono";
import { z } from "zod";
import {
	AuthError,
	type AuthOptions,
	type AuthPrincipal,
	resolveAuth
} from "./auth";
import { errorResponse } from "./errors";
import type { Env } from "./worker";

const ACCOUNT_URL = "https://app.uwu.land/dashboard/account";
const STRIPE_API = "https://api.stripe.com/v1";
const checkoutSchema = z.object({
	cadence: z.enum(["monthly", "yearly"])
}).strict() satisfies z.ZodType<BillingCheckoutRequest>;

type SessionPrincipal = Extract<AuthPrincipal, { kind: "session" }>;

export interface BillingRouteOptions {
	auth?: AuthOptions;
	stripeFetch?: typeof fetch;
}

export async function createBillingCheckout(
	c: Context<{ Bindings: Env }>,
	options: BillingRouteOptions = {}
): Promise<Response> {
	const auth = await requireSession(c, options);
	if (auth instanceof Response) {
		return auth;
	}

	const body = await readJson(c.req.raw);
	const parsed = checkoutSchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(400, "invalid_body", "Invalid request body.");
	}
	if (auth.tier === "pro") {
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
	const priceId =
		parsed.data.cadence === "monthly"
			? c.env.STRIPE_PRICE_ID_MONTHLY
			: c.env.STRIPE_PRICE_ID_YEARLY;
	const params = new URLSearchParams({
		mode: "subscription",
		"line_items[0][price]": priceId,
		"line_items[0][quantity]": "1",
		client_reference_id: auth.userId,
		"subscription_data[metadata][userId]": auth.userId,
		success_url: `${ACCOUNT_URL}?upgraded=1`,
		cancel_url: ACCOUNT_URL
	});
	const url = await createStripeSession(
		options.stripeFetch ?? fetch,
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
	const auth = await requireSession(c, options);
	if (auth instanceof Response) {
		return auth;
	}

	const subscription = await c.env.DB.prepare(
		"SELECT customer_id FROM stripe_subscriptions WHERE user_id = ? ORDER BY CASE WHEN status IN ('active', 'trialing', 'past_due') THEN 0 ELSE 1 END, event_timestamp DESC LIMIT 1"
	)
		.bind(auth.userId)
		.first<{ customer_id: string }>();
	if (subscription === null) {
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
			customer: subscription.customer_id,
			return_url: ACCOUNT_URL
		})
	);
	if (url === null) {
		return stripeUnavailable();
	}

	return Response.json({ url } satisfies BillingPortalResponse);
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
			headers: {
				authorization: `Bearer ${secret}`,
				"content-type": "application/x-www-form-urlencoded"
			},
			body
		});
	} catch {
		return null;
	}
	if (!response.ok) {
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

async function requireSession(
	c: Context<{ Bindings: Env }>,
	options: BillingRouteOptions
): Promise<SessionPrincipal | Response> {
	let auth: AuthPrincipal;
	try {
		auth = await resolveAuth(c.req.raw, c.env, c.executionCtx, options.auth);
	} catch (error) {
		if (error instanceof AuthError) {
			return errorResponse(401, "unauthorized", "Unauthorized.");
		}
		throw error;
	}

	if (auth.kind === "anon") {
		return errorResponse(401, "unauthorized", "Authentication required.");
	}
	if (auth.kind === "key") {
		return errorResponse(403, "forbidden", "API keys cannot manage billing.");
	}
	return auth;
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

function stripeUnavailable(): Response {
	return errorResponse(
		502,
		"billing_unavailable",
		"Billing is temporarily unavailable."
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
