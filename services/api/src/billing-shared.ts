export const ENTITLING_STATUSES = ["active", "trialing", "past_due"] as const;

export const ENTITLING_STATUS_SQL = ENTITLING_STATUSES.map(
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
