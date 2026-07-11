export type TierKey = "anon" | "free" | "pro";

export interface TierLimits {
	createPerDay: number;
	apiKeys: number;
	priceUsdMonthly?: number | null;
}

export const TIERS = {
	anon: {
		createPerDay: 15,
		apiKeys: 0
	},
	free: {
		createPerDay: 120,
		apiKeys: 1
	},
	pro: {
		createPerDay: 2000,
		apiKeys: 10,
		priceUsdMonthly: null
	}
} as const satisfies Record<TierKey, TierLimits>;

export function limitsFor(tier: TierKey): (typeof TIERS)[TierKey] {
	return TIERS[tier];
}
