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
	it("collapses IPv6 to its /64 whatever the spelling", () => {
		const key = (ip: string) =>
			ipKey(new Request("https://uwu.land", { cf: {}, headers: { "CF-Connecting-IP": ip } }));
		expect(key("2001:db8:0:1::1")).toBe("2001:db8:0:1::/64");
		expect(key("2001:0DB8:0000:0001:ffff:0000:0000:0002")).toBe("2001:db8:0:1::/64");
		expect(key("2001:db8::1:2:3:4")).toBe("2001:db8:0:0::/64");
		expect(key("2001:db8:0:2::1")).toBe("2001:db8:0:2::/64");
		expect(key("::1")).toBe("0:0:0:0::/64");
	});
	it("keys IPv4-mapped IPv6 on the bare IPv4 address", () => {
		const key = (ip: string) =>
			ipKey(new Request("https://uwu.land", { cf: {}, headers: { "CF-Connecting-IP": ip } }));
		expect(key("::ffff:192.0.2.1")).toBe("192.0.2.1");
		expect(key("::FFFF:c000:201")).toBe("192.0.2.1");
	});
});
