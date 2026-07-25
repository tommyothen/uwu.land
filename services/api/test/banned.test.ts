import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { isBannedHostname } from "../src/banned";

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
