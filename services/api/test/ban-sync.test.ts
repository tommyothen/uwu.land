import { env } from "cloudflare:test";
import { links } from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BAN_FEEDS, type FeedSource } from "../src/ban-feeds";
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

// Serves each feed's URL from `bodies`; a feed left out publishes nothing.
function feedsOf(bodies: Partial<Record<FeedSource, string | Response | Error>>): typeof fetch {
	return async (input) => {
		const feed = BAN_FEEDS.find(({ url }) => url === String(input));
		const body = feed === undefined ? undefined : bodies[feed.source];
		if (body instanceof Error) throw body;
		return body instanceof Response ? body : new Response(body ?? "");
	};
}

function sourceOf(domains: string[]): typeof fetch {
	return feedsOf({ auto: domains.join("\n") });
}

const [GRABIFY, URLHAUS] = BAN_FEEDS;
const NOTHING = { added: 0, scanned: 0, refused: false };

describe("banned-domain sync", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
		await resetD1(env.DB);
	});

	it("adds new valid domains as auto while preserving manual entries", async () => {
		await env.UWU.put("banned:manual.example", "1");

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			feedsOf({ auto: "# comment\nmanual.example\nNew.Example\ninvalid\nother.example\n" })
		);

		expect(result).toEqual({ feeds: { auto: { added: 2, scanned: 3, refused: false }, urlhaus: NOTHING }, swept: 0 });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
		expect(await env.UWU.get("banned:new.example")).toBe("auto");
		expect(await env.UWU.get("banned:other.example")).toBe("auto");
	});

	it("does not add anything when the fetch fails or returns no domains", async () => {
		await env.UWU.put("banned:manual.example", "1");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			syncBannedDomains({ UWU: env.UWU, DB: env.DB }, feedsOf({ auto: new Error("network failure") }))
		).resolves.toEqual({ feeds: { auto: { added: 0, scanned: 0, refused: false }, urlhaus: NOTHING }, swept: 0 });
		await expect(
			syncBannedDomains(
				{ UWU: env.UWU, DB: env.DB },
				feedsOf({ auto: "# only a comment\nnot-a-domain" })
			)
		).resolves.toEqual({ feeds: { auto: { added: 0, scanned: 0, refused: false }, urlhaus: NOTHING }, swept: 0 });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
		// A dead feed is logged, so it cannot sit broken behind quiet runs.
		expect(consoleError).toHaveBeenCalledWith(
			"Blocklist feed could not be fetched.",
			expect.objectContaining({ feed: "auto" })
		);
		consoleError.mockRestore();
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

		expect(result).toEqual({ feeds: { auto: { added: 1, scanned: 4, refused: false }, urlhaus: NOTHING }, swept: 0 });
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

		expect(result).toEqual({ feeds: { auto: { added: 0, scanned: 400, refused: true }, urlhaus: NOTHING }, swept: 0 });
		expect(await env.UWU.get("banned:flood0.example")).toBeNull();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("allows a full cap's worth against a small existing set", async () => {
		// The cap is fixed per feed, not scaled by the existing set, so a small
		// set never makes an ordinary run trip the guard.
		await seedBans(5);
		const batch = Array.from(
			{ length: GRABIFY.maxAdds },
			(_, index) => `new${index}.example`
		);

		const result = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(batch));

		expect(result).toEqual({
			feeds: { auto: { added: GRABIFY.maxAdds, scanned: GRABIFY.maxAdds, refused: false }, urlhaus: NOTHING },
			swept: 0
		});
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

		expect(result).toEqual({ feeds: { auto: { added: 2, scanned: 2, refused: false }, urlhaus: NOTHING }, swept: 0 });
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

		expect(result).toEqual({ feeds: { auto: { added: 0, scanned: 0, refused: false }, urlhaus: NOTHING }, swept: 0 });
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

		expect(result).toEqual({ feeds: { auto: { added: 0, scanned: 0, refused: false }, urlhaus: NOTHING }, swept: 0 });
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

		expect(result).toEqual({ feeds: { auto: { added: 1, scanned: 1, refused: false }, urlhaus: NOTHING }, swept: 0 });
		expect(await env.UWU.get("banned:evil.example")).toBe("auto");
		expect(await env.UWU.get("banned:innocent.example")).toBeNull();
	});

	it("accepts punycode TLDs and refuses bare public suffixes", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			// co.ke and *.ck come from the full Public Suffix List; github.io is a
			// private suffix, refused all the same.
			sourceOf(["xn--e1afmkfd.xn--p1ai", "co.uk", "co.ke", "customer.co.ke", "anything.ck", "github.io", "evil.github.io"])
		);

		expect(result).toEqual({ feeds: { auto: { added: 3, scanned: 7, refused: false }, urlhaus: NOTHING }, swept: 0 });
		expect(await env.UWU.get("banned:xn--e1afmkfd.xn--p1ai")).toBe("auto");
		expect(await env.UWU.get("banned:customer.co.ke")).toBe("auto");
		expect(await env.UWU.get("banned:evil.github.io")).toBe("auto");
		for (const suffix of ["co.uk", "co.ke", "anything.ck", "github.io"]) {
			expect(await env.UWU.get(`banned:${suffix}`)).toBeNull();
		}
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
		expect(result).toEqual({ feeds: { auto: { added: 1, scanned: 1, refused: false }, urlhaus: NOTHING }, swept: 2 });

		await reconcilePendingLinks(env as Env);
		const remaining = await db.select({ slug: links.slug }).from(links).all();
		expect(remaining.map((row) => row.slug).sort()).toEqual(["lookalike", "mention", "suffix"]);
		for (const slug of ["apex", "sub"]) {
			expect(await env.UWU.get(slug)).toBeNull();
			expect(await env.UWU.get(`urlmap:hash-${slug}`)).toBeNull();
		}
		expect(await env.UWU.get("lookalike")).toBe(seeded.lookalike);
	});

	it("sweeps manual bans too, so a link that beat a stale KV read still comes down", async () => {
		const db = drizzle(env.DB);
		await env.UWU.put("banned:manual.example", "1");
		await db.insert(links).values({ slug: "late", url: "https://manual.example/x", source: "web-anon" }).run();

		const result = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(["feed.example"]));
		expect(result).toEqual({ feeds: { auto: { added: 1, scanned: 1, refused: false }, urlhaus: NOTHING }, swept: 1 });
	});

	it("still sweeps existing bans when the feed fails or is refused", async () => {
		const db = drizzle(env.DB);
		await seedBans(150);
		await env.UWU.put("banned:manual.example", "1");
		await db.insert(links).values({ slug: "late-a", url: "https://manual.example/a", source: "web-anon" }).run();

		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = feedsOf({ auto: new Response("", { status: 503 }) });
		const afterFailure = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, failed);
		expect(afterFailure).toEqual({ feeds: { auto: { added: 0, scanned: 0, refused: false }, urlhaus: NOTHING }, swept: 1 });

		await db.insert(links).values({ slug: "late-b", url: "https://manual.example/b", source: "web-anon" }).run();
		const flood = Array.from({ length: 400 }, (_, index) => `flood${index}.example`);
		const afterRefusal = await syncBannedDomains({ UWU: env.UWU, DB: env.DB }, sourceOf(flood));
		expect(afterRefusal).toEqual({ feeds: { auto: { added: 0, scanned: 400, refused: true }, urlhaus: NOTHING }, swept: 1 });
		consoleError.mockRestore();
	});

	it("parses the URLhaus domains-online format", async () => {
		// Shape of malware-filter's urlhaus-filter-domains-online.txt as of
		// 2026-11-20: a comment header, then one host per line, about two thirds
		// of them IPv4. IPs are dropped (creates refuse IP-literal hosts anyway)
		// and must not set off the unparseable-feed alarm.
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			feedsOf({
				urlhaus: [
					"# Title: Online Malicious Domains Blocklist",
					"# Updated: 2026-11-20T00:09:58Z",
					"# Expires: 12 hours (update frequency)",
					"# Source: https://urlhaus.abuse.ch/api/",
					"1.92.136.152",
					"101.108.76.71",
					"payload.example",
					"dropper.cdn.example"
				].join("\n")
			})
		);

		expect(result).toEqual({
			feeds: { auto: NOTHING, urlhaus: { added: 2, scanned: 2, refused: false } },
			swept: 0
		});
		expect(await env.UWU.get("banned:payload.example")).toBe("urlhaus");
		expect(await env.UWU.get("banned:dropper.cdn.example")).toBe("urlhaus");
		expect(await env.UWU.get("banned:1.92.136.152")).toBeNull();
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("isolates a failing feed from the others", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			feedsOf({ auto: new Error("network failure"), urlhaus: "malware.example" })
		);

		expect(result.feeds).toEqual({
			auto: NOTHING,
			urlhaus: { added: 1, scanned: 1, refused: false }
		});
		expect(await env.UWU.get("banned:malware.example")).toBe("urlhaus");
		consoleError.mockRestore();
	});

	it("caps each feed on its own budget", async () => {
		// Grabify trips its cap while URLhaus adds more than grabify's cap in
		// the same run: neither the refusal nor the budget is shared.
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const domains = (prefix: string, count: number) =>
			Array.from({ length: count }, (_, index) => `${prefix}${index}.example`).join("\n");

		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			feedsOf({
				auto: domains("grabber", GRABIFY.maxAdds + 1),
				urlhaus: domains("malware", URLHAUS.maxAdds)
			})
		);

		expect(URLHAUS.maxAdds).toBeGreaterThan(GRABIFY.maxAdds);
		expect(result.feeds).toEqual({
			auto: { added: 0, scanned: GRABIFY.maxAdds + 1, refused: true },
			urlhaus: { added: URLHAUS.maxAdds, scanned: URLHAUS.maxAdds, refused: false }
		});
		expect(await env.UWU.get("banned:grabber0.example")).toBeNull();
		expect(await env.UWU.get("banned:malware0.example")).toBe("urlhaus");
		consoleError.mockRestore();
	});

	it("keeps the first feed's value for a domain both feeds publish", async () => {
		const result = await syncBannedDomains(
			{ UWU: env.UWU, DB: env.DB },
			feedsOf({ auto: "shared.example", urlhaus: "shared.example" })
		);

		expect(result.feeds.urlhaus).toEqual({ added: 0, scanned: 1, refused: false });
		expect(await env.UWU.get("banned:shared.example")).toBe("auto");
	});
	it("waits for a slow write in a failing batch before the next feed runs", async () => {
		// One write fails while another is still in flight. The slow one must
		// land and count before URLhaus decides the shared domain is missing.
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const put = async (key: string, value: string) => {
			if (key === "banned:broken.example") throw new Error("KV write failed");
			await new Promise((resolve) => setTimeout(resolve, 20));
			return env.UWU.put(key, value);
		};
		const uwu = new Proxy(env.UWU, {
			get: (target, property) => {
				if (property === "put") return put;
				const value: unknown = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			}
		});

		const result = await syncBannedDomains(
			{ UWU: uwu, DB: env.DB },
			feedsOf({ auto: "broken.example\nshared.example", urlhaus: "shared.example" })
		);

		expect(result.feeds.auto).toEqual({ added: 1, scanned: 2, refused: false });
		expect(result.feeds.urlhaus).toEqual({ added: 0, scanned: 1, refused: false });
		expect(await env.UWU.get("banned:shared.example")).toBe("auto");
		consoleError.mockRestore();
	});
});
