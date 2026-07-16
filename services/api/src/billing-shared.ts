export const ENTITLING_STATUSES = ["active", "trialing", "past_due"] as const;

export const ENTITLING_STATUS_SQL = ENTITLING_STATUSES.map(
	(status) => `'${status}'`
).join(", ");

// Every Stripe subscription status except the terminal two (canceled,
// incomplete_expired). Account deletion must cancel all of these, not just
// the entitling ones, or a paused/unpaid/incomplete subscription would
// outlive the account and keep echoing webhook events at us.
export const NON_TERMINAL_STATUSES = [
	"active",
	"trialing",
	"past_due",
	"unpaid",
	"incomplete",
	"paused"
] as const;

export const NON_TERMINAL_STATUS_SQL = NON_TERMINAL_STATUSES.map(
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
