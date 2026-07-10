import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/normalize";

describe("normalizeUrl", () => {
	it("uses https and lowercases the scheme and hostname through URL parsing", () => {
		expect(normalizeUrl("HTTPS://EXAMPLE.com/")).toBe("https://example.com");
	});

	it("preserves path case and query strings", () => {
		expect(normalizeUrl("https://EXAMPLE.com/Mixed/Path?q=KeepMe")).toBe(
			"https://example.com/Mixed/Path?q=KeepMe"
		);
	});

	it("strips fragments", () => {
		expect(normalizeUrl("https://example.com/path?q=1#fragment")).toBe(
			"https://example.com/path?q=1"
		);
	});

	it("strips default ports", () => {
		expect(normalizeUrl("https://example.com:443/path")).toBe(
			"https://example.com/path"
		);
		expect(normalizeUrl("http://example.com:80/path")).toBe(
			"http://example.com/path"
		);
	});

	it("only strips a trailing slash when the path is exactly the root", () => {
		expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
		expect(normalizeUrl("https://example.com/path/")).toBe(
			"https://example.com/path/"
		);
	});
});
