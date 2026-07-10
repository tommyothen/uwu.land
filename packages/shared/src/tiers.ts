export type TierKey = "anon" | "free" | "pro";

export interface TierLimits {
	createPerDay: number;
	apiPerMin: number;
	apiKeys: number;
	priceUsdMonthly?: number | null;
}

export const TIERS = {
	anon: {
		createPerDay: 30,
		apiPerMin: 10,
		apiKeys: 0
	},
	free: {
		createPerDay: 120,
		apiPerMin: 60,
		apiKeys: 1
	},
	pro: {
		createPerDay: 2000,
		apiPerMin: 600,
		apiKeys: 10,
		priceUsdMonthly: null
	}
} as const satisfies Record<TierKey, TierLimits>;

export function limitsFor(tier: TierKey): (typeof TIERS)[TierKey] {
	return TIERS[tier];
}
