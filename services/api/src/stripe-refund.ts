import { isRecord } from "./request-utils";

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
