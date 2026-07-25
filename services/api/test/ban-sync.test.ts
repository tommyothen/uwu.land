import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncBannedDomains } from "../src/ban-sync";

async function clearKv(namespace: KVNamespace): Promise<void> {
	const list = await namespace.list();
	await Promise.all(list.keys.map((key) => namespace.delete(key.name)));
}

async function seedBans(count: number): Promise<void> {
	for (let index = 0; index < count; index++) {
		await env.UWU.put(`banned:seed${index}.example`, "auto");
	}
}

function sourceOf(domains: string[]): typeof fetch {
	return (async () => new Response(domains.join("\n"))) as typeof fetch;
}

describe("banned-domain sync", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
	});

	it("adds new valid domains as auto while preserving manual entries", async () => {
		await env.UWU.put("banned:manual.example", "1");

		const result = await syncBannedDomains(
			{ UWU: env.UWU },
			async () =>
				new Response(
					"# comment\nmanual.example\nNew.Example\ninvalid\nother.example\n"
				)
		);

		expect(result).toEqual({ added: 2, scanned: 3, refused: false });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
		expect(await env.UWU.get("banned:new.example")).toBe("auto");
		expect(await env.UWU.get("banned:other.example")).toBe("auto");
	});

	it("does not add anything when the fetch fails or returns no domains", async () => {
		await env.UWU.put("banned:manual.example", "1");

		await expect(
			syncBannedDomains({ UWU: env.UWU }, async () => {
				throw new Error("network failure");
			})
		).resolves.toEqual({ added: 0, scanned: 0, refused: false });
		await expect(
			syncBannedDomains(
				{ UWU: env.UWU },
				async () => new Response("# only a comment\nnot-a-domain")
			)
		).resolves.toEqual({ added: 0, scanned: 0, refused: false });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
	});

	it("never auto-bans an allowlisted domain or anything under it", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU },
			sourceOf([
				"google.com",
				"sites.google.com",
				"github.com",
				"real-grabber.example"
			])
		);

		expect(result).toEqual({ added: 1, scanned: 4, refused: false });
		expect(await env.UWU.get("banned:google.com")).toBeNull();
		expect(await env.UWU.get("banned:sites.google.com")).toBeNull();
		expect(await env.UWU.get("banned:github.com")).toBeNull();
		expect(await env.UWU.get("banned:real-grabber.example")).toBe("auto");
		// An upstream feed listing google.com is compromised, squatted or
		// broken; that log line is the alarm.
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("leaves a manually banned allowlisted domain in place", async () => {
		// The allowlist filters what we ADD; it must never scrub a deliberate
		// incident-response ban back out of KV.
		await env.UWU.put("banned:google.com", "1");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await syncBannedDomains({ UWU: env.UWU }, sourceOf(["google.com"]));

		expect(await env.UWU.get("banned:google.com")).toBe("1");
		consoleError.mockRestore();
	});

	it("refuses a run that would add an implausible number of domains", async () => {
		await seedBans(10);
		const flood = Array.from(
			{ length: 400 },
			(_, index) => `flood${index}.example`
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains({ UWU: env.UWU }, sourceOf(flood));

		expect(result).toEqual({ added: 0, scanned: 400, refused: true });
		expect(await env.UWU.get("banned:flood0.example")).toBeNull();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("allows a plausible delta against a small existing set", async () => {
		// Production carries ~71 keys and upstream publishes ~29, so an ordinary
		// run must never trip the guard just because the existing set is small.
		await seedBans(5);
		const batch = Array.from(
			{ length: 60 },
			(_, index) => `new${index}.example`
		);

		const result = await syncBannedDomains({ UWU: env.UWU }, sourceOf(batch));

		expect(result).toEqual({ added: 60, scanned: 60, refused: false });
		expect(await env.UWU.get("banned:new0.example")).toBe("auto");
	});

	it("adds nothing while upstream publishes annotated lines", async () => {
		// As of 2026-07-25 mayzelf/grabify-domains publishes
		// `domain - (Domain expires: YYYY-MM-DD)`, which no line of matches
		// DOMAIN_RE, so the daily sync is a silent no-op. Pinned here so the
		// dead feed stays a documented fact rather than an accident.
		const result = await syncBannedDomains(
			{ UWU: env.UWU },
			sourceOf([
				"location.cyou - (Domain expires: 2025-04-12)",
				"stopify.co - (Domain expires: 2024-08-11)"
			])
		);

		expect(result).toEqual({ added: 0, scanned: 0, refused: false });
		expect(await env.UWU.get("banned:location.cyou")).toBeNull();
	});
});
