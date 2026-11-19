import { spawnSync } from "node:child_process";
import { getDomain } from "tldts";

// Rows read per D1 query. URLs are capped at 2048 characters on input, so even
// a page of worst-case percent-encoded URLs stays well inside D1_MAX_BUFFER.
const PAGE_SIZE = 200;
const D1_MAX_BUFFER = 16 * 1024 * 1024;
// Keeps each UPDATE well under D1's 100 KB statement limit.
const MAX_STATEMENT_LENGTH = 90_000;

/**
 * Turns an operator's DOMAIN argument into the hostname the worker sees, so a
 * unicode domain becomes punycode. Returns null for anything that is not a
 * plain multi-label hostname.
 */
export function parseHostname(value) {
	// URL parsing would quietly reduce `evil.example/path` or `user@evil.example`
	// to a hostname; an argument like that is more likely a mistake than intent.
	if (/[/?#@:\\\s]/.test(value) || !URL.canParse(`https://${value}`)) return null;
	const hostname = new URL(`https://${value}`).hostname;
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname) ? hostname : null;
}

/**
 * parseHostname, but also null for a registry or hosting suffix (`co.ke`,
 * `github.io`) whose subdomains belong to unrelated owners: a sweep on one
 * would take down every link under it. Matches isPublicSuffix in
 * src/ban-sync.ts.
 */
export function parseBannableDomain(value) {
	const hostname = parseHostname(value);
	if (hostname === null) return null;
	return getDomain(hostname, { allowPrivateDomains: true }) === null ? null : hostname;
}

/**
 * Yields live links whose host is `domain` or a subdomain of it, a page at a
 * time. Pages are read lazily, so a caller that marks each page before asking
 * for the next keeps every Wrangler response bounded. Keyset pagination on
 * slug rather than OFFSET, because marked rows leave the result set.
 */
export function* linkPagesOnDomain(domain) {
	let after = "";
	for (;;) {
		// The LIKE only narrows the scan; the parsed hostname decides.
		const page = d1Rows(
			`SELECT slug, url FROM links WHERE lifecycle_state IN ('active', 'pending_publish') AND lower(url) LIKE '%${sqlLiteral(domain)}%' AND slug > '${sqlLiteral(after)}' ORDER BY slug LIMIT ${PAGE_SIZE}`
		);
		yield page.filter((row) => typeof row.slug === "string" && urlIsUnderDomain(row.url, domain));
		const last = page.at(-1)?.slug;
		if (page.length < PAGE_SIZE || typeof last !== "string") return;
		after = last;
	}
}

/**
 * Hands links to the worker's reconciler, which removes their KV entries
 * (including the `urlmap:` dedup key) and then the row, on its next cron pass.
 * Each row matches on the URL that was read as well as the slug, so a slug
 * freed and reused since the read is left alone.
 */
export function markForDeletion(rows) {
	let clauses = [];
	let length = 0;
	const flush = () => {
		if (clauses.length === 0) return;
		runWrangler([
			"d1", "execute", "uwu-land", "--remote", "--command",
			`UPDATE links SET lifecycle_state = 'pending_delete' WHERE lifecycle_state IN ('active', 'pending_publish') AND (${clauses.join(" OR ")})`
		]);
		clauses = [];
		length = 0;
	};
	for (const row of rows) {
		const clause = `(slug = '${sqlLiteral(row.slug)}' AND url = '${sqlLiteral(row.url)}')`;
		if (length + clause.length > MAX_STATEMENT_LENGTH) flush();
		clauses.push(clause);
		length += clause.length + 4;
	}
	flush();
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
		{ encoding: "utf8", maxBuffer: D1_MAX_BUFFER, shell: process.platform === "win32" }
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
