import { describe, expect, it } from "vitest";
import { ipKey } from "../src/abuse";

describe("ipKey", () => {
	it("shares a bucket for direct requests regardless of spoofed headers", () => {
		for (const ip of ["192.0.2.1", "192.0.2.2"]) {
			expect(ipKey(new Request("https://uwu.land", { headers: { "CF-Connecting-IP": ip } }))).toBe("direct");
		}
		expect(ipKey(new Request("https://uwu.land"))).toBe("direct");
	});
	it("uses the proxy header only with runtime metadata", () => {
		expect(ipKey(new Request("https://uwu.land", { cf: {}, headers: { "CF-Connecting-IP": "192.0.2.1" } }))).toBe("192.0.2.1");
		expect(ipKey(new Request("https://uwu.land", { cf: {} }))).toBe("unknown");
	});
});
