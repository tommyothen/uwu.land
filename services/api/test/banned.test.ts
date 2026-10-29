import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { isBannedHostname, isBannedPath } from "../src/banned";

async function clearKv(namespace: KVNamespace): Promise<void> {
	const list = await namespace.list();
	await Promise.all(list.keys.map((key) => namespace.delete(key.name)));
}

describe("isBannedHostname", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
	});

	it("matches the exact host and its parent domains", async () => {
		await env.UWU.put("banned:example.com", "1");

		expect(await isBannedHostname(env.UWU, "example.com")).toBe(true);
		expect(await isBannedHostname(env.UWU, "sub.deep.example.com")).toBe(true);
		expect(await isBannedHostname(env.UWU, "EXAMPLE.COM")).toBe(true);
	});

	it("leaves unrelated hosts alone", async () => {
		await env.UWU.put("banned:example.com", "1");

		expect(await isBannedHostname(env.UWU, "notexample.com")).toBe(false);
		expect(await isBannedHostname(env.UWU, "example.com.evil.test")).toBe(false);
	});

	it("never matches a bare final label", async () => {
		await env.UWU.put("banned:com", "1");

		expect(await isBannedHostname(env.UWU, "example.com")).toBe(false);
		expect(await isBannedHostname(env.UWU, "sub.example.com")).toBe(false);
		expect(await isBannedHostname(env.UWU, "com")).toBe(false);
	});

	it("still matches a banned literal IP address", async () => {
		await env.UWU.put("banned:198.51.100.7", "1");

		expect(await isBannedHostname(env.UWU, "198.51.100.7")).toBe(true);
		expect(await isBannedHostname(env.UWU, "198.51.100.8")).toBe(false);
	});
});

describe("isBannedPath", () => {
	it("matches a campaign path regardless of case or trailing slash", () => {
		expect(isBannedPath("/wqamhcsom")).toBe(true);
		expect(isBannedPath("/WQAMHCSOM/")).toBe(true);
	});

	it("sees through percent-encoding and doubled slashes", () => {
		expect(isBannedPath("/%77qamhcsom")).toBe(true);
		expect(isBannedPath("//wqamhcsom//")).toBe(true);
		expect(isBannedPath("/%2Fwqamhcsom")).toBe(true);
	});

	it("ignores malformed percent-encoding", () => {
		expect(isBannedPath("/%E0%A4%A")).toBe(false);
	});

	it("leaves other paths alone", () => {
		expect(isBannedPath("/")).toBe(false);
		expect(isBannedPath("/wqamhcsom/extra")).toBe(false);
		expect(isBannedPath("/docs/wqamhcsom")).toBe(false);
	});
});
