import { spawnSync } from "node:child_process";
import publicSuffixes from "../src/public-suffixes.json" with { type: "json" };

/**
 * Registry and hosting suffixes (`co.uk`, `github.io`) whose subdomains belong
 * to unrelated owners. isBannedHostname refuses to match a bare final label, so
 * `ban com` is inert there, but a two-label suffix still matches every domain
 * under it. Shared with the worker's feed sync (src/ban-sync.ts).
 */
const PUBLIC_SUFFIXES = new Set(publicSuffixes);

// Keeps the statement well under D1's 100 KB limit.
const UPDATE_BATCH = 500;

/**
 * Turns an operator's DOMAIN argument into the hostname the worker sees, so a
 * unicode domain becomes punycode. Returns null for anything that is not a
 * plain multi-label hostname or is a bare public suffix.
 */
export function parseBannableDomain(value) {
	// URL parsing would quietly reduce `evil.example/path` or `user@evil.example`
	// to a hostname; an argument like that is more likely a mistake than intent.
	if (/[/?#@:\\\s]/.test(value) || !URL.canParse(`https://${value}`)) return null;
	const hostname = new URL(`https://${value}`).hostname;
	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)) return null;
	return PUBLIC_SUFFIXES.has(hostname) ? null : hostname;
}

/** Live links whose host is `domain` or a subdomain of it. */
export function findLinksOnDomain(domain) {
	// The LIKE only narrows the scan; the parsed hostname decides.
	return d1Rows(
		`SELECT slug, url FROM links WHERE lifecycle_state IN ('active', 'pending_publish') AND lower(url) LIKE '%${sqlLiteral(domain)}%'`
	).filter((row) => typeof row.slug === "string" && urlIsUnderDomain(row.url, domain));
}

/**
 * Hands links to the worker's reconciler, which removes their KV entries
 * (including the `urlmap:` dedup key) and then the row, on its next cron pass.
 */
export function markForDeletion(slugs) {
	for (let index = 0; index < slugs.length; index += UPDATE_BATCH) {
		const list = slugs.slice(index, index + UPDATE_BATCH).map((slug) => `'${sqlLiteral(slug)}'`).join(", ");
		runWrangler([
			"d1", "execute", "uwu-land", "--remote", "--command",
			`UPDATE links SET lifecycle_state = 'pending_delete' WHERE slug IN (${list}) AND lifecycle_state IN ('active', 'pending_publish')`
		]);
	}
}

function urlIsUnderDomain(url, domain) {
	if (typeof url !== "string" || !URL.canParse(url)) return false;
	const hostname = new URL(url).hostname;
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function sqlLiteral(value) {
	return value.replaceAll("'", "''");
}

function d1Rows(sql) {
	const result = spawnSync(
		"pnpm",
		["exec", "wrangler", "d1", "execute", "uwu-land", "--remote", "--json", "--command", sql],
		{ encoding: "utf8", shell: process.platform === "win32" }
	);
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	try {
		const payload = JSON.parse(result.stdout);
		if (!Array.isArray(payload)) throw new Error("expected an array");
		return payload.flatMap((entry) => (Array.isArray(entry.results) ? entry.results : []));
	} catch (error) {
		throw new Error(`Wrangler returned invalid D1 JSON: ${error.message}`);
	}
}

function runWrangler(args) {
	const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
		stdio: "inherit",
		shell: process.platform === "win32"
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
