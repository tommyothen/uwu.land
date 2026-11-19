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
		priceUsdLifetime: 40
	}
} as const satisfies Record<TierKey, TierLimits>;

// Anonymous API calls that send no Turnstile token (a plain curl) get this many
// links a day per IP, on top of counting toward TIERS.anon.createPerDay. The
// homepage always sends a token, so it gets the full anonymous quota.
export const ANON_KEYLESS_CREATE_PER_DAY = 3;

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
// Explicit sticker prices, not computed, so they stay exact. Both are
// precisely 25% off, so the advertised discount is literally true.
export const LAUNCH_PRICES = { monthly: 3, lifetime: 30 } as const;
