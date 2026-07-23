import { describe, expect, it } from "vitest";
import {
	LAUNCH_DISCOUNT_PCT,
	LAUNCH_OFFER,
	LAUNCH_PRICES,
	limitsFor,
	TIERS
} from "./tiers";

describe("tier limits", () => {
	it("defines the anonymous limits", () => {
		expect(TIERS.anon.createPerDay).toBe(20);
		expect(limitsFor("anon")).toBe(TIERS.anon);
	});

	it("defines all planned v2 tier keys with starting limits", () => {
		expect(Object.keys(TIERS).sort()).toEqual(["anon", "free", "pro"]);
		expect(TIERS.free).toMatchObject({
			createPerDay: 250,
			apiKeys: 2
		});
		expect(TIERS.pro).toMatchObject({
			createPerDay: 10000,
			apiKeys: 10,
			displayName: "First-Class",
			priceUsdMonthly: 4,
			priceUsdLifetime: 79
		});
	});

	it("prices First-Class at $4 monthly and $79 lifetime", () => {
		expect(TIERS.pro.priceUsdMonthly).toBe(4);
		expect(TIERS.pro.priceUsdLifetime).toBe(79);
		expect("priceUsdYearly" in TIERS.pro).toBe(false);
	});

	it("declares the 25% launch offer with exact sticker prices", () => {
		expect(LAUNCH_OFFER).toBe(true);
		expect(LAUNCH_DISCOUNT_PCT).toBe(25);
		expect(LAUNCH_PRICES.monthly).toBe(3);
		expect(LAUNCH_PRICES.lifetime).toBe(59);
	});
});
