import {
	applyGuards,
	BAN_FEEDS,
	type BanFeed,
	type FeedSource,
	isPublicSuffix,
	parseFeed
} from "./ban-feeds";
import { markDomainLinksForDeletion } from "./link-reconciliation";
import type { Env } from "./worker";

const WRITE_BATCH_SIZE = 100;

export interface FeedResult {
	added: number;
	scanned: number;
	/** True when this feed's cap rejected the run and nothing was written. */
	refused: boolean;
}

export interface BanSyncResult {
	feeds: Record<FeedSource, FeedResult>;
	/** Live links on a listed domain handed to the reconciler for deletion. */
	swept: number;
}

/**
 * Daily cron entry. Adds new domains from each feed in BAN_FEEDS, then sweeps
 * links on every banned domain whatever the feeds did. Feeds run one after
 * another and each is isolated: one that fails, publishes nothing parseable or
 * trips its cap leaves the others untouched, and none of them can skip the
 * sweep, because it is the backstop for links created while a KV edge still
 * served a stale "not banned" (manual bans included).
 */
export async function syncBannedDomains(
	env: Pick<Env, "UWU" | "DB">,
	fetchImpl: typeof fetch = fetch
): Promise<BanSyncResult> {
	// Listed once and grown as feeds write, so a domain in two feeds keeps the
	// value of the first. KV list can lag a put, so it could not be re-listed
	// for the sweep anyway.
	const existing = await existingBannedDomains(env.UWU);
	const feeds = {} as Record<FeedSource, FeedResult>;
	for (const feed of BAN_FEEDS) {
		feeds[feed.source] = await syncFeed(env, feed, existing, fetchImpl);
	}
	const everyBan = [...existing].filter((domain) => !isPublicSuffix(domain));
	const swept = await markDomainLinksForDeletion(env.DB, everyBan);
	return { feeds, swept };
}

const NOTHING: FeedResult = { added: 0, scanned: 0, refused: false };

async function syncFeed(
	env: Pick<Env, "UWU">,
	feed: BanFeed,
	existing: Set<string>,
	fetchImpl: typeof fetch
): Promise<FeedResult> {
	let source: string;
	try {
		const response = await fetchImpl(feed.url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		source = await response.text();
	} catch (error) {
		console.error("Blocklist feed could not be fetched.", {
			feed: feed.source,
			error: String(error)
		});
		return NOTHING;
	}

	const { candidateLines, domains } = parseFeed(source);
	if (domains.length === 0) {
		// Content in and nothing out means the feed's shape moved out from under
		// the parser, which is exactly how this sync once sat dead for months
		// while every run reported success. An empty or all-comment feed is a
		// different thing and stays quiet, so this line only fires when there
		// was something to read and we could not read it.
		if (candidateLines.length > 0) {
			console.error("Blocklist source published no parseable domains.", {
				feed: feed.source,
				candidateLines: candidateLines.length,
				// Enough to recognise the new shape, truncated because the sample
				// is untrusted third-party text on its way into our logs.
				sample: candidateLines.slice(0, 3).map((line) => line.slice(0, 120))
			});
		}
		return NOTHING;
	}

	const { accepted, rejected } = applyGuards(domains);
	if (rejected.length > 0) {
		// The highest-value signal in this file. A blocklist of IP loggers or
		// malware hosts has no business naming these, so their presence means
		// the feed is compromised, squatted, or broken: investigate before
		// trusting anything else it published.
		console.error(
			"Blocklist source published allowlisted domains or public suffixes; they were ignored. Review the upstream feed.",
			{ feed: feed.source, domains: rejected.slice(0, 20), total: rejected.length }
		);
	}

	const missing = accepted.filter((domain) => !existing.has(domain));
	if (missing.length > feed.maxAdds) {
		// Fail closed and stay closed. Every subsequent run refuses the same
		// way until a human looks, which is the point: a sudden bulk expansion
		// of the ban list is either an upstream compromise or a deliberate
		// change that deserves review. There is deliberately no bootstrap
		// escape hatch either; a new feed is seeded by hand with
		// scripts/seed-feed.mjs. If the growth is genuine, seed it or raise
		// maxAdds and redeploy.
		console.error(
			"Blocklist sync refused: implausible number of new domains. Review the upstream feed, then seed it with scripts/seed-feed.mjs or raise maxAdds in ban-feeds.ts if the growth is genuine.",
			{
				feed: feed.source,
				adding: missing.length,
				allowed: feed.maxAdds,
				sample: missing.slice(0, 20)
			}
		);
		return { added: 0, scanned: domains.length, refused: true };
	}

	let added = 0;
	try {
		for (let index = 0; index < missing.length; index += WRITE_BATCH_SIZE) {
			await Promise.all(
				missing.slice(index, index + WRITE_BATCH_SIZE).map(async (domain) => {
					await env.UWU.put(`banned:${domain}`, feed.source);
					existing.add(domain);
					added++;
				})
			);
		}
	} catch (error) {
		// A KV failure stops this feed only. Whatever landed is already in
		// `existing`, so today's sweep still covers it.
		console.error("Blocklist feed could not be written.", {
			feed: feed.source,
			error: String(error)
		});
	}

	return { added, scanned: domains.length, refused: false };
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
