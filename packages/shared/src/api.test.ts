import { describe, expect, it } from "vitest";
import type {
	ApiKeySummary,
	BillingCheckoutRequest,
	BillingCheckoutResponse,
	BillingPortalResponse,
	CreateKeyRequest,
	CreateKeyResponse,
	LinkStatsResponse,
	ListKeysResponse,
	MeResponse
} from "./api";
import { TIERS } from "./tiers";

describe("api contract types", () => {
	it("round-trips key management shapes", () => {
		const key = {
			id: "9f4c2f8a-0000-0000-0000-000000000000",
			name: "hayasaka bot",
			display_prefix: "uwu_a1B2c3D4",
			created_at: "2026-07-10T12:00:00.000Z",
			last_used_at: null
		} satisfies ApiKeySummary;

		const list = { keys: [key] } satisfies ListKeysResponse;
		expect(list.keys[0]?.last_used_at).toBeNull();

		const request = { name: "hayasaka bot" } satisfies CreateKeyRequest;
		const created = {
			id: key.id,
			name: request.name,
			secret: "uwu_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6",
			display_prefix: key.display_prefix
		} satisfies CreateKeyResponse;
		expect(created.secret.startsWith("uwu_")).toBe(true);
	});

	it("round-trips /me and stats shapes", () => {
		const me = {
			user_id: "user_123",
			tier: "free",
			hasBillingHistory: false,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		} satisfies MeResponse;
		expect(me.limits.apiKeys).toBe(TIERS.free.apiKeys);

		const stats = { slug: "abc12", clicks: 42 } satisfies LinkStatsResponse;
		expect(stats.clicks).toBe(42);
	});

	it("round-trips billing session shapes", () => {
		const request = { cadence: "yearly" } satisfies BillingCheckoutRequest;
		const checkout = {
			url: "https://checkout.stripe.com/c/pay_test"
		} satisfies BillingCheckoutResponse;
		const portal = {
			url: "https://billing.stripe.com/p/session_test"
		} satisfies BillingPortalResponse;

		expect(request.cadence).toBe("yearly");
		expect(checkout.url).toContain("checkout.stripe.com");
		expect(portal.url).toContain("billing.stripe.com");
	});
});
