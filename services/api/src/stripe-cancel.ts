import { isRecord } from "./request-utils";

// Cancels a single Stripe subscription. Shared by account deletion (which
// cancels every non-terminal subscription) and the stripe webhook's
// deleted-user backstop. "ok" covers the idempotent cases too: an HTTP 404
// or a resource_missing error means the subscription is already gone.
export async function cancelStripeSubscription(
	stripeFetch: typeof fetch,
	secret: string,
	subscriptionId: string
): Promise<"ok" | "failed"> {
	const url = `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
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
		return "failed";
	}
	if (response.ok || response.status === 404) {
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
		// Status and endpoint still identify the failed Stripe operation.
	}
	if (code === "resource_missing") {
		return "ok";
	}
	console.error("Stripe subscription cancellation failed.", {
		endpoint: new URL(url).pathname,
		status: response.status,
		type,
		code
	});
	return "failed";
}
