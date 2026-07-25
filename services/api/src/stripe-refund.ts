import { isRecord } from "./request-utils";

/**
 * Whether a payment intent already has a refund against it.
 *
 * Guards the entitlement write: `charge.refunded` for a purchase we have not
 * recorded yet finds no row to revoke and is acknowledged, so if the
 * session event is still being retried when the refund lands, the retry would
 * otherwise insert a fresh `paid` row that nothing ever revokes.
 *
 * "unknown" means Stripe could not be asked. Callers should entitle anyway: a
 * refund racing a stuck session event is rare, a transport failure is rare, and
 * withholding First-Class from someone who paid is worse than the manual
 * cleanup of their conjunction.
 */
export async function paymentIntentRefundState(
	stripeFetch: typeof fetch,
	secret: string,
	paymentIntentId: string
): Promise<"refunded" | "not_refunded" | "unknown"> {
	const url = `https://api.stripe.com/v1/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=1`;
	let response: Response;
	try {
		response = await stripeFetch(url, {
			headers: { authorization: `Bearer ${secret}` }
		});
	} catch {
		console.error("Stripe refund lookup failed.", { paymentIntentId });
		return "unknown";
	}
	if (!response.ok) {
		console.error("Stripe refund lookup failed.", {
			paymentIntentId,
			status: response.status
		});
		return "unknown";
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		console.error("Stripe refund lookup returned no JSON.", {
			paymentIntentId
		});
		return "unknown";
	}
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		return "unknown";
	}
	// A refund in any non-failed state counts: `pending` still means the money
	// is on its way back, so entitling would hand out First-Class for free.
	const refunded = payload.data.some(
		(refund) =>
			isRecord(refund) &&
			typeof refund.status === "string" &&
			refund.status !== "failed" &&
			refund.status !== "canceled"
	);
	return refunded ? "refunded" : "not_refunded";
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
