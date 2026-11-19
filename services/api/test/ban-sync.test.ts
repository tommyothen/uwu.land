import { env } from "cloudflare:test";
import { links } from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncBannedDomains } from "../src/ban-sync";
import { reconcilePendingLinks } from "../src/link-reconciliation";
import type { Env } from "../src/worker";
import { resetD1 } from "./helpers/d1";

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
		await resetD1(env.DB);
	});

	it("adds new valid domains as auto while preserving manual entries", async () => {
		await env.UWU.put("banned:manual.example", "1");

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			async () =>
				new Response(
					"# comment\nmanual.example\nNew.Example\ninvalid\nother.example\n"
				)
		);

		expect(result).toEqual({ added: 2, scanned: 3, swept: 0, refused: false });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
		expect(await env.UWU.get("banned:new.example")).toBe("auto");
		expect(await env.UWU.get("banned:other.example")).toBe("auto");
	});

	it("does not add anything when the fetch fails or returns no domains", async () => {
		await env.UWU.put("banned:manual.example", "1");

		await expect(
			syncBannedDomains({ UWU: env.UWU, DB: env.DB }, async () => {
				throw new Error("network failure");
			})
		).resolves.toEqual({ added: 0, scanned: 0, swept: 0, refused: false });
		await expect(
			syncBannedDomains(
				{ UWU: env.UWU, DB: env.DB },
				async () => new Response("# only a comment\nnot-a-domain")
			)
		).resolves.toEqual({ added: 0, scanned: 0, swept: 0, refused: false });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
	});

	it("never auto-bans an allowlisted domain or anything under it", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			sourceOf([
				"google.com",
				"sites.google.com",
				"github.com",
				"real-grabber.example"
			])
		);

		expect(result).toEqual({ added: 1, scanned: 4, swept: 0, refused: false });
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

		await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(["google.com"]));

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

		const result = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(flood));

		expect(result).toEqual({ added: 0, scanned: 400, swept: 0, refused: true });
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

		const result = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(batch));

		expect(result).toEqual({ added: 60, scanned: 60, swept: 0, refused: false });
		expect(await env.UWU.get("banned:new0.example")).toBe("auto");
	});

	it("parses the domain out of annotated upstream lines", async () => {
		// As of 2026-07-25 mayzelf/grabify-domains publishes
		// `domain - (Domain expires: YYYY-MM-DD)`. The parser takes the first
		// whitespace-separated token, so the annotation must not sink the entry.
		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			sourceOf([
				"location.cyou - (Domain expires: 2025-04-12)",
				"stopify.co - (Domain expires: 2024-08-11)"
			])
		);

		expect(result).toEqual({ added: 2, scanned: 2, swept: 0, refused: false });
		expect(await env.UWU.get("banned:location.cyou")).toBe("auto");
		expect(await env.UWU.get("banned:stopify.co")).toBe("auto");
	});

	it("alarms when a feed full of content parses to nothing", async () => {
		// The root cause of the months-long dead sync: upstream changed format,
		// every line stopped parsing, and the run returned success with zero
		// adds. Content in, nothing out, is never routine.
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			sourceOf([
				"2025-04-12 | location.cyou | expired",
				"2025-04-12 | mymap.icu | expired"
			])
		);

		expect(result).toEqual({ added: 0, scanned: 0, swept: 0, refused: false });
		expect(consoleError).toHaveBeenCalledWith(
			"Blocklist source published no parseable domains.",
			expect.objectContaining({ candidateLines: 2 })
		);
		consoleError.mockRestore();
	});

	it("stays quiet when the feed legitimately carries no entries", async () => {
		// An empty or all-comment feed is not a format break, and alarming on it
		// would train whoever reads these logs to ignore the one that matters.
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			sourceOf(["# nothing to publish today", "", "   "])
		);

		expect(result).toEqual({ added: 0, scanned: 0, swept: 0, refused: false });
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("takes only the first token, so an annotation cannot smuggle a ban", async () => {
		// The security-relevant half of the annotation parsing: everything after
		// the first whitespace-separated token is upstream prose, and a domain
		// mentioned in it must not become a ban of its own. Guards against a
		// future refactor that scans every token on the line, which would keep
		// the test above green while turning upstream's annotation into a way to
		// add unreviewed bans. The trailing domain is deliberately bare — inside
		// brackets the closing paren fails DOMAIN_RE on its own and the test
		// would pass no matter how the parser were written.
		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			sourceOf(["evil.example - see also innocent.example"])
		);

		expect(result).toEqual({ added: 1, scanned: 1, swept: 0, refused: false });
		expect(await env.UWU.get("banned:evil.example")).toBe("auto");
		expect(await env.UWU.get("banned:innocent.example")).toBeNull();
	});

	it("accepts punycode TLDs and refuses bare public suffixes", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			sourceOf(["xn--e1afmkfd.xn--p1ai", "co.uk", "github.io", "evil.github.io"])
		);

		expect(result).toEqual({ added: 2, scanned: 4, swept: 0, refused: false });
		expect(await env.UWU.get("banned:xn--e1afmkfd.xn--p1ai")).toBe("auto");
		expect(await env.UWU.get("banned:evil.github.io")).toBe("auto");
		expect(await env.UWU.get("banned:co.uk")).toBeNull();
		expect(await env.UWU.get("banned:github.io")).toBeNull();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("takes down existing links on a banned domain and its subdomains", async () => {
		const db = drizzle(env.DB);
		const seeded = {
			apex: "https://evil.example/a",
			sub: "https://www.evil.example/b?x=1",
			lookalike: "https://notevil.example/c",
			mention: "https://safe.example/?next=evil.example",
			suffix: "https://evil.example.org/d"
		};
		for (const [slug, url] of Object.entries(seeded)) {
			await db.insert(links).values({ slug, url, source: "web-anon", urlHash: `hash-${slug}` }).run();
			await env.UWU.put(slug, url);
			await env.UWU.put(`urlmap:hash-${slug}`, slug);
		}

		const result = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(["evil.example"]));
		expect(result).toEqual({ added: 1, scanned: 1, swept: 2, refused: false });

		await reconcilePendingLinks(env as Env);
		const remaining = await db.select({ slug: links.slug }).from(links).all();
		expect(remaining.map((row) => row.slug).sort()).toEqual(["lookalike", "mention", "suffix"]);
		for (const slug of ["apex", "sub"]) {
			expect(await env.UWU.get(slug)).toBeNull();
			expect(await env.UWU.get(`urlmap:hash-${slug}`)).toBeNull();
		}
		expect(await env.UWU.get("lookalike")).toBe(seeded.lookalike);
	});
});
