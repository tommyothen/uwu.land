import { isRecord } from "./request-utils";

// GETs a Stripe resource. "missing" is a 404, "failed" means Stripe could not
// be asked or answered with something other than a JSON object.
async function stripeGet(
	stripeFetch: typeof fetch,
	secret: string,
	url: string,
	headers: Record<string, string> = {}
): Promise<Record<string, unknown> | "missing" | "failed"> {
	let response: Response;
	try {
		response = await stripeFetch(url, {
			headers: { authorization: `Bearer ${secret}`, ...headers }
		});
	} catch {
		console.error("Stripe lookup failed.", { endpoint: new URL(url).pathname });
		return "failed";
	}
	if (response.status === 404) {
		return "missing";
	}
	if (!response.ok) {
		console.error("Stripe lookup failed.", {
			endpoint: new URL(url).pathname,
			status: response.status
		});
		return "failed";
	}
	try {
		const payload: unknown = await response.json();
		return isRecord(payload) ? payload : "failed";
	} catch {
		console.error("Stripe lookup returned no JSON.", {
			endpoint: new URL(url).pathname
		});
		return "failed";
	}
}

// Whether any item in a Stripe list matches, or null when the payload is not a
// list we can read.
function listSome(
	payload: Record<string, unknown> | "missing" | "failed",
	match: (item: Record<string, unknown>) => boolean
): boolean | null {
	if (typeof payload === "string" || !Array.isArray(payload.data)) {
		return null;
	}
	return payload.data.some((item) => isRecord(item) && match(item));
}

/**
 * Whether the money behind a payment intent has already gone back, by refund
 * or by a lost dispute.
 *
 * Guards the entitlement write: `charge.refunded` or `charge.dispute.closed`
 * for a purchase we have not recorded yet finds no row to revoke and is
 * acknowledged, so if the session event is still being retried when either
 * lands, the retry would otherwise insert a fresh `paid` row that nothing ever
 * revokes.
 *
 * "unknown" means Stripe could not be asked. Callers should entitle anyway: a
 * reversal racing a stuck session event is rare, a transport failure is rare,
 * and withholding First-Class from someone who paid is worse than the manual
 * cleanup of their conjunction.
 */
export async function paymentIntentReversal(
	stripeFetch: typeof fetch,
	secret: string,
	paymentIntentId: string
): Promise<"refunded" | "disputed" | "none" | "unknown"> {
	const query = `payment_intent=${encodeURIComponent(paymentIntentId)}`;
	const [refunds, disputes] = await Promise.all([
		stripeGet(
			stripeFetch,
			secret,
			`https://api.stripe.com/v1/refunds?${query}&limit=1`
		),
		stripeGet(stripeFetch, secret, `https://api.stripe.com/v1/disputes?${query}`)
	]);
	// A refund in any non-failed state counts: `pending` still means the money
	// is on its way back, so entitling would hand out First-Class for free.
	const refunded = listSome(
		refunds,
		(refund) =>
			typeof refund.status === "string" &&
			refund.status !== "failed" &&
			refund.status !== "canceled"
	);
	const disputed = listSome(disputes, (dispute) => dispute.status === "lost");
	if (refunded === true) {
		return "refunded";
	}
	if (disputed === true) {
		return "disputed";
	}
	return refunded === null || disputed === null ? "unknown" : "none";
}

// Refunds a payment intent in full. Used by the stripe webhook's
// deleted-user backstop when a lifetime Checkout completes for an account
// that no longer exists. "ok" covers idempotent outcomes: an already
// fully-refunded intent (charge_already_refunded) or a missing resource.
export async function refundStripePaymentIntent(
	stripeFetch: typeof fetch,
	secret: string,
	paymentIntentId: string
): Promise<"ok" | "failed"> {
	const url = "https://api.stripe.com/v1/refunds";
	let response: Response;
	try {
		response = await stripeFetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${secret}`,
				"content-type": "application/x-www-form-urlencoded"
			},
			body: new URLSearchParams({ payment_intent: paymentIntentId })
		});
	} catch {
		console.error("Stripe refund failed.", { paymentIntentId });
		return "failed";
	}
	if (response.ok) {
		return "ok";
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
		// Status alone still identifies the failed refund.
	}
	if (code === "charge_already_refunded" || code === "resource_missing") {
		return "ok";
	}
	console.error("Stripe refund failed.", {
		paymentIntentId,
		status: response.status,
		type,
		code
	});
	return "failed";
}

// The last API version where a charge names its invoice and an invoice names
// its subscription. Later versions moved both behind invoice payments, so the
// lookup below pins this one rather than depend on the account default.
const CHARGE_INVOICE_API_VERSION = "2025-02-24.acacia";

// The subscription a charge paid an invoice for, or null when it paid no
// subscription invoice (a lifetime purchase, a guest payment) or no longer
// exists. A dispute names its charge but not what it bought, so the lost
// dispute handler asks here. "failed" means Stripe could not be asked and the
// caller should let the event retry.
export async function chargeSubscriptionId(
	stripeFetch: typeof fetch,
	secret: string,
	chargeId: string
): Promise<string | null | "failed"> {
	const charge = await stripeGet(
		stripeFetch,
		secret,
		`https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}?expand[]=invoice`,
		{ "stripe-version": CHARGE_INVOICE_API_VERSION }
	);
	if (charge === "failed" || charge === "missing") {
		return charge === "failed" ? "failed" : null;
	}
	const invoice = isRecord(charge.invoice) ? charge.invoice : null;
	return typeof invoice?.subscription === "string" &&
		invoice.subscription.length > 0
		? invoice.subscription
		: null;
}
