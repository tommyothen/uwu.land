export type TierKey = "anon" | "free" | "pro";

export interface TierLimits {
	createPerDay: number;
	apiKeys: number;
	displayName: string;
	priceUsdMonthly?: number | null;
	priceUsdYearly?: number | null;
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
		priceUsdYearly: 36
	}
} as const satisfies Record<TierKey, TierLimits>;

export function limitsFor(tier: TierKey): (typeof TIERS)[TierKey] {
	return TIERS[tier];
}
