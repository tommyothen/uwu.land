import { describe, expect, it } from "vitest";
import { limitsFor, TIERS } from "./tiers";

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
			priceUsdYearly: 36
		});
	});
});
