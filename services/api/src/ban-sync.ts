import type { Env } from "./worker";

const SOURCE_URL =
	"https://raw.githubusercontent.com/mayzelf/grabify-domains/main/domains.txt";
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const MAX_DOMAINS = 5_000;
const WRITE_BATCH_SIZE = 100;

// This sync is an unguarded trust anchor: it takes whatever a third-party repo
// publishes on `main`, every day, forever, and only ever ADDS bans. A
// compromise, a squat of an abandoned repo, or a plain upstream mistake would
// land straight in KV. The two constants below are the blast-radius floor.

// Apexes that can never be auto-banned. A `banned:` key blocks the domain and
// every subdomain under it (see banned.ts), so one bad entry here would stop
// link creation to a large slice of the web service-wide — a self-inflicted
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

// A single run may add at most this many domains, or half the existing set,
// whichever is larger. Production carries ~71 `banned:` keys and the upstream
// feed publishes ~29 entries, so 100 leaves better than 3x headroom over any
// delta ever observed while still refusing a bulk push. There is deliberately
// no bootstrap escape hatch: adopting a large new feed SHOULD stop and ask a
// human, and the refusal is sticky until someone raises this number.
const MIN_DELTA = 100;
const MAX_GROWTH_RATIO = 0.5;

export interface BanSyncResult {
	added: number;
	scanned: number;
	/** True when the delta guard rejected the run and nothing was written. */
	refused: boolean;
}

export async function syncBannedDomains(
	env: Pick<Env, "UWU">,
	fetchImpl: typeof fetch = fetch
): Promise<BanSyncResult> {
	let response: Response;
	try {
		response = await fetchImpl(SOURCE_URL);
	} catch {
		return { added: 0, scanned: 0, refused: false };
	}

	if (!response.ok) {
		return { added: 0, scanned: 0, refused: false };
	}

	let source: string;
	try {
		source = await response.text();
	} catch {
		return { added: 0, scanned: 0, refused: false };
	}

	const candidateLines = source
		.split("\n")
		.map((line) => line.trim().toLowerCase())
		.filter((line) => line !== "" && !line.startsWith("#"));
	const parsed = candidateLines
		// The feed annotates entries (`domain - (Domain expires: YYYY-MM-DD)`);
		// the domain itself is the first whitespace-separated token. Anything
		// after it is metadata, not part of the hostname.
		.map((line) => line.split(/\s+/, 1)[0] ?? "")
		.filter((domain) => DOMAIN_RE.test(domain))
		.slice(0, MAX_DOMAINS);
	if (parsed.length === 0) {
		// Content in and nothing out means the feed's shape moved out from under
		// the parser above, which is exactly how this sync sat dead for months
		// while every run reported success. An empty or all-comment feed is a
		// different thing and stays quiet, so this line only fires when there
		// was something to read and we could not read it.
		if (candidateLines.length > 0) {
			console.error("Blocklist source published no parseable domains.", {
				candidateLines: candidateLines.length,
				// Enough to recognise the new shape, truncated because the sample
				// is untrusted third-party text on its way into our logs.
				sample: candidateLines.slice(0, 3).map((line) => line.slice(0, 120))
			});
		}
		return { added: 0, scanned: 0, refused: false };
	}

	const candidates: string[] = [];
	const rejected: string[] = [];
	for (const domain of new Set(parsed)) {
		if (isNeverAutoBanned(domain)) {
			rejected.push(domain);
		} else {
			candidates.push(domain);
		}
	}
	if (rejected.length > 0) {
		// The highest-value signal in this file. A blocklist of IP-logger
		// domains has no business naming these, so their presence means the
		// feed is compromised, squatted, or broken — investigate before
		// trusting anything else it published.
		console.error(
			"Blocklist source published allowlisted domains; they were ignored. Review the upstream feed.",
			{ domains: rejected.slice(0, 20), total: rejected.length }
		);
	}

	const existing = await existingBannedDomains(env.UWU);
	const missing = candidates.filter((domain) => !existing.has(domain));

	const allowedAdds = Math.max(
		MIN_DELTA,
		Math.ceil(existing.size * MAX_GROWTH_RATIO)
	);
	if (missing.length > allowedAdds) {
		// Fail closed and stay closed. Every subsequent run refuses the same
		// way until a human looks, which is the point: a sudden bulk expansion
		// of the ban list is either an upstream compromise or a deliberate
		// change that deserves review. If the growth is genuine, raise
		// MIN_DELTA and redeploy.
		console.error(
			"Blocklist sync refused: implausible number of new domains. Review the upstream feed, then raise MIN_DELTA in ban-sync.ts if the growth is genuine.",
			{
				adding: missing.length,
				existing: existing.size,
				allowed: allowedAdds,
				sample: missing.slice(0, 20)
			}
		);
		return { added: 0, scanned: parsed.length, refused: true };
	}

	for (let index = 0; index < missing.length; index += WRITE_BATCH_SIZE) {
		await Promise.all(
			missing
				.slice(index, index + WRITE_BATCH_SIZE)
				.map(async (domain) => env.UWU.put(`banned:${domain}`, "auto"))
		);
	}

	return { added: missing.length, scanned: parsed.length, refused: false };
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

async function existingBannedDomains(kv: KVNamespace): Promise<Set<string>> {
	const domains = new Set<string>();
	let cursor: string | undefined;

	do {
		const page = await kv.list({ prefix: "banned:", cursor });
		for (const key of page.keys) {
			domains.add(key.name.slice("banned:".length));
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor !== undefined);

	return domains;
}
