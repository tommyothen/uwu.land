import { describe, expect, it } from "vitest";
import { limitsFor, TIERS } from "./tiers";

describe("tier limits", () => {
	it("defines the anonymous limits", () => {
		expect(TIERS.anon.createPerDay).toBe(30);
		expect(TIERS.anon.apiPerMin).toBe(10);
		expect(limitsFor("anon")).toBe(TIERS.anon);
	});

	it("defines all planned v2 tier keys with starting limits", () => {
		expect(Object.keys(TIERS).sort()).toEqual(["anon", "free", "pro"]);
		expect(TIERS.free).toMatchObject({
			createPerDay: 120,
			apiPerMin: 60,
			apiKeys: 1
		});
		expect(TIERS.pro).toMatchObject({
			createPerDay: 2000,
			apiPerMin: 600,
			apiKeys: 10,
			priceUsdMonthly: null
		});
	});
});
