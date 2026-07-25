import { isRecord } from "./request-utils";

/**
 * How to end a subscription:
 *
 * - `immediate` deletes it now, forfeiting any time already paid for. Correct
 *   for account deletion and the deleted-user backstop, where the account must
 *   stop billing at once and nobody is left to keep the remaining days.
 * - `at_period_end` lets the paid-for period run out and stops the renewal.
 *   Correct for the lifetime upgrade, where the subscriber is still a customer
 *   and taking their unused days away would be charging twice for the overlap.
 */
export type CancelMode = "immediate" | "at_period_end";

// Cancels a single Stripe subscription. Shared by account deletion (which
// cancels every non-terminal subscription), the stripe webhook's deleted-user
// backstop, and the lifetime upgrade path. "ok" covers the idempotent cases
// too: an HTTP 404 or a resource_missing error means the subscription is
// already gone, and an at_period_end update against an already-canceled
// subscription has nothing left to schedule.
export async function cancelStripeSubscription(
	stripeFetch: typeof fetch,
	secret: string,
	subscriptionId: string,
	mode: CancelMode = "immediate"
): Promise<"ok" | "failed"> {
	const url = `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
	const init: RequestInit =
		mode === "immediate"
			? { method: "DELETE", headers: { authorization: `Bearer ${secret}` } }
			: {
					method: "POST",
					headers: {
						authorization: `Bearer ${secret}`,
						"content-type": "application/x-www-form-urlencoded"
					},
					body: new URLSearchParams({ cancel_at_period_end: "true" })
				};
	let response: Response;
	try {
		response = await stripeFetch(url, init);
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
	// Stripe rejects cancel_at_period_end on a subscription that is already
	// canceled or incomplete_expired, and gives no stable error code for it —
	// only prose, which is not worth pattern-matching. Retry as an immediate
	// cancel instead: if the subscription really is terminal this is a no-op,
	// and if it somehow is not, ending it now beats leaving the caller in a
	// fail-closed retry loop. For the lifetime upgrade that loop would mean the
	// buyer paid and never got entitled, which is worse than losing the tail of
	// a billing period.
	if (mode === "at_period_end" && response.status === 400) {
		console.error("Falling back to an immediate Stripe cancellation.", {
			endpoint: new URL(url).pathname,
			type,
			code
		});
		return cancelStripeSubscription(
			stripeFetch,
			secret,
			subscriptionId,
			"immediate"
		);
	}
	console.error("Stripe subscription cancellation failed.", {
		endpoint: new URL(url).pathname,
		status: response.status,
		type,
		code
	});
	return "failed";
}
