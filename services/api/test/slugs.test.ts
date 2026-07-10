import { describe, expect, it } from "vitest";
import { isValidCustomSlug, SLUG_RE } from "../src/slugs";

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
	});
});
