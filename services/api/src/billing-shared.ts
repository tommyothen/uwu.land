export const ENTITLING_STATUSES = ["active", "trialing", "past_due"] as const;

export const ENTITLING_STATUS_SQL = ENTITLING_STATUSES.map(
	(status) => `'${status}'`
).join(", ");

// The two terminal Stripe subscription statuses. Account deletion cancels
// everything NOT in this list (a deny-list rather than an allow-list of
// known live statuses), so an unknown future status is still cancelled
// instead of outliving the account and echoing webhook events at us.
export const TERMINAL_STATUSES = ["canceled", "incomplete_expired"] as const;

export const TERMINAL_STATUS_SQL = TERMINAL_STATUSES.map(
	(status) => `'${status}'`
).join(", ");

export function configuredPriceIds(env: {
	STRIPE_PRICE_ID_MONTHLY?: string;
	STRIPE_PRICE_ID_YEARLY?: string;
}): [string, string] {
	return [
		env.STRIPE_PRICE_ID_MONTHLY ?? "",
		env.STRIPE_PRICE_ID_YEARLY ?? ""
	];
}
