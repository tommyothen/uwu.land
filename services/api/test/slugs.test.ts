import { describe, expect, it } from "vitest";
import { isValidCustomSlug, randomSlug, SLUG_RE } from "../src/slugs";

describe("slug validation", () => {
	it("accepts v1-compatible custom slug shapes", () => {
		expect(SLUG_RE.test("abc")).toBe(true);
		expect(SLUG_RE.test("a_b-C1")).toBe(true);
		expect(SLUG_RE.test("a".repeat(16))).toBe(true);
	});

	it("rejects invalid or reserved slugs", () => {
		expect(SLUG_RE.test("ab")).toBe(false);
		expect(SLUG_RE.test("a".repeat(17))).toBe(false);
		expect(SLUG_RE.test("sp ace")).toBe(false);
		expect(isValidCustomSlug("api")).toBe(false);
		expect(isValidCustomSlug("API")).toBe(false);
		expect(isValidCustomSlug("webhooks")).toBe(false);
	});

	it("reserves site, account and apps/web paths case-insensitively", () => {
		for (const slug of ["login", "Admin", "BILLING", "sign-in", "support"]) {
			expect(isValidCustomSlug(slug)).toBe(false);
		}
		expect(isValidCustomSlug("logins")).toBe(true);
	});

	it("generates 8-character slugs, too many to enumerate", () => {
		const slug = randomSlug();
		expect(slug).toHaveLength(8);
		expect(SLUG_RE.test(slug)).toBe(true);
	});
});
