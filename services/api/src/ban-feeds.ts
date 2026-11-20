import { getDomain } from "tldts";

// The third-party blocklists synced into KV as `banned:<domain>` keys, plus the
// parsing and guards every feed goes through. Kept free of Worker imports so
// scripts/seed-feed.mjs can load it under Node and seed with exactly the same
// rules the daily sync applies.

/**
 * One blocklist. `source` is written as the `banned:` value, so an operator
 * can tell which feed added a key; any value that is not a feed source is a
 * manual ban (see scripts/banned.mjs).
 */
export interface BanFeed {
	source: string;
	url: string;
	/**
	 * Most new domains one run may add from this feed. Fixed per feed, so a
	 * busy or compromised feed cannot spend another's budget.
	 */
	maxAdds: number;
}

export const BAN_FEEDS = [
	{
		// IP-logger domains. Kept as "auto", the value this feed has always
		// written, so existing keys stay attributed to it.
		source: "auto",
		url: "https://raw.githubusercontent.com/mayzelf/grabify-domains/main/domains.txt",
		// Production carries ~71 keys from this feed and upstream publishes ~29
		// entries, so 100 leaves better than 3x headroom over any delta ever
		// observed while still refusing a bulk push.
		maxAdds: 100
	},
	{
		// Domains currently serving malware according to abuse.ch URLhaus,
		// rebuilt twice a day by malware-filter (CC0). Popular and shared hosts
		// are already stripped upstream. Mirror: curbengh.github.io/malware-filter;
		// the pages.dev mirrors were a month stale when this was added.
		source: "urlhaus",
		url: "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt",
		// Measured 2026-11-20: 588 domains (plus ~1.3k IPv4 lines the parser
		// drops), and 20 domains new between two consecutive 12-hour builds, so
		// a daily run should see ~40. 150 covers that 3.5x over, and a missed
		// day, while still refusing a switch to the 18k full list. Together the
		// two caps stay far inside KV's 1,000 free writes a day.
		maxAdds: 150
	}
] as const satisfies readonly BanFeed[];

export type FeedSource = (typeof BAN_FEEDS)[number]["source"];

/** Every `banned:` value a feed writes. Anything else is a manual ban. */
export const FEED_SOURCES: ReadonlySet<string> = new Set(
	BAN_FEEDS.map((feed) => feed.source)
);

// The final label is letters or an IDN TLD in punycode (`xn--p1ai`), which a
// letters-only TLD rule would drop without a word. IP literals never match,
// which is fine: creates already refuse IP-literal hosts.
const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;
const MAX_DOMAINS = 5_000;

// Each sync is an unguarded trust anchor: it takes whatever a third-party
// publishes, every day, forever, and only ever ADDS bans. A compromise, a
// squat of an abandoned repo, or a plain upstream mistake would land straight
// in KV. NEVER_AUTO_BAN, the public suffix check and each feed's maxAdds are
// the blast-radius floor.

// Apexes that can never be auto-banned. A `banned:` key blocks the domain and
// every subdomain under it (see banned.ts), so one bad entry here would stop
// link creation to a large slice of the web service-wide: a self-inflicted
// outage from someone else's commit. These are destinations where that is
// never the right call, so the answer is always "ban the specific host by
// hand" instead. It is a floor, not a substitute for trusting the feed.
const NEVER_AUTO_BAN = new Set([
	"amazon.com",
	"apple.com",
	"bing.com",
	"cloudflare.com",
	"discord.com",
	"dropbox.com",
	"facebook.com",
	"github.com",
	"gitlab.com",
	"gmail.com",
	"google.com",
	"instagram.com",
	"linkedin.com",
	"microsoft.com",
	"netflix.com",
	"notion.so",
	"office.com",
	"reddit.com",
	"spotify.com",
	"stackoverflow.com",
	"tiktok.com",
	"twitch.tv",
	"twitter.com",
	"uwu.land",
	"whatsapp.com",
	"wikipedia.org",
	"x.com",
	"youtube.com",
	"zoom.us"
]);

export interface ParsedFeed {
	/** Non-blank, non-comment lines, lowercased. */
	candidateLines: string[];
	/** Valid hostnames, deduplicated, at most MAX_DOMAINS. */
	domains: string[];
}

/**
 * Reads one hostname per line. Both feeds fit this: `#` comments, and either
 * a bare host (URLhaus, IPv4 lines included) or a host followed by an
 * annotation (grabify's `domain - (Domain expires: YYYY-MM-DD)`). Only the
 * first whitespace-separated token is ever read, so an annotation cannot
 * smuggle in a ban of its own.
 */
export function parseFeed(source: string): ParsedFeed {
	const candidateLines = source
		.split("\n")
		.map((line) => line.trim().toLowerCase())
		.filter((line) => line !== "" && !line.startsWith("#"));
	const domains = candidateLines
		.map((line) => line.split(/\s+/, 1)[0] ?? "")
		.filter((domain) => DOMAIN_RE.test(domain))
		.slice(0, MAX_DOMAINS);
	return { candidateLines, domains: [...new Set(domains)] };
}

/** Splits parsed domains into ones a feed may ban and ones it never may. */
export function applyGuards(domains: readonly string[]): {
	accepted: string[];
	rejected: string[];
} {
	const accepted: string[] = [];
	const rejected: string[] = [];
	for (const domain of domains) {
		if (isNeverAutoBanned(domain) || isPublicSuffix(domain)) {
			rejected.push(domain);
		} else {
			accepted.push(domain);
		}
	}
	return { accepted, rejected };
}

// True for a registry or hosting suffix (`co.ke`, `github.io`) whose subdomains
// belong to unrelated owners. A ban on one would sweep every link under it, so
// it is always a mistake; banning one site on github.io is fine. Matches
// scripts/domain-sweep.mjs. Private suffixes are included on purpose.
export function isPublicSuffix(domain: string): boolean {
	return getDomain(domain, { allowPrivateDomains: true }) === null;
}

// Walks the domain's own suffixes, stopping before the bare final label so a
// TLD can never appear allowlisted. Mirrors the lookup in banned.ts, so an
// allowlisted apex protects exactly the set of hostnames a `banned:` key on
// that apex would have blocked.
function isNeverAutoBanned(domain: string): boolean {
	const labels = domain.split(".");
	for (let index = 0; index < labels.length - 1; index++) {
		if (NEVER_AUTO_BAN.has(labels.slice(index).join("."))) {
			return true;
		}
	}
	return false;
}
