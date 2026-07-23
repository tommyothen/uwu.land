export type TierKey = "anon" | "free" | "pro";

export interface TierLimits {
	createPerDay: number;
	apiKeys: number;
	displayName: string;
	priceUsdMonthly?: number | null;
	priceUsdLifetime?: number | null;
}

export const TIERS = {
	anon: {
		createPerDay: 20,
		apiKeys: 0,
		displayName: "Anonymous"
	},
	free: {
		createPerDay: 250,
		apiKeys: 2,
		displayName: "Free"
	},
	pro: {
		createPerDay: 10000,
		apiKeys: 10,
		displayName: "First-Class",
		priceUsdMonthly: 4,
		priceUsdLifetime: 79
	}
} as const satisfies Record<TierKey, TierLimits>;

export function limitsFor(tier: TierKey): (typeof TIERS)[TierKey] {
	return TIERS[tier];
}

// Launch offer. Flipping LAUNCH_OFFER to false ends it everywhere: the web
// badge and the checkout discount both read this constant, so they cannot
// drift. Existing launch subscribers keep their forever-duration Stripe
// coupon; nothing else changes.
export const LAUNCH_OFFER = true;
export const LAUNCH_DISCOUNT_PCT = 25;
// How many customers the offer is limited to. Advertised in the UI; the
// monthly coupon can enforce it in Stripe via max_redemptions, the lifetime
// launch price is retired by flipping LAUNCH_OFFER.
export const LAUNCH_LIMIT = 1000;
// Explicit sticker prices, not computed, so they stay exact ($59 is 25.3% off).
export const LAUNCH_PRICES = { monthly: 3, lifetime: 59 } as const;
