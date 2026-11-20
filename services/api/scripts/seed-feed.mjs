import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { applyGuards, BAN_FEEDS, parseFeed } from "../src/ban-feeds.ts";
import { linkPagesOnDomains, markForDeletion } from "./domain-sweep.mjs";

// Bulk-adds a feed's current domains, for the first import the daily sync's
// per-feed cap deliberately refuses. Same parsing and guards as the sync
// (src/ban-feeds.ts), never overwrites an existing `banned:` key, and sweeps
// links on the new bans afterwards like `pnpm ban`. Dry run without --yes.
//
//   node scripts/seed-feed.mjs <source> [--file PATH] [--yes]
//
// --file seeds from a copy already downloaded and reviewed instead of
// fetching the feed again.

const options = parseOptions();
const feed = BAN_FEEDS.find((candidate) => candidate.source === options?.positionals[0]);
if (options === null || options.positionals.length !== 1 || feed === undefined) {
	console.error(
		`Usage: seed-feed.mjs <${BAN_FEEDS.map((candidate) => candidate.source).join(" | ")}> [--file PATH] [--yes]`
	);
	process.exit(1);
}
const { file, yes: confirmed } = options.values;

const text = file === undefined ? await fetchFeed(feed.url) : readFileSync(file, "utf8");
const { candidateLines, domains } = parseFeed(text);
const { accepted, rejected } = applyGuards(domains);
if (rejected.length > 0) {
	console.error(`Ignored ${rejected.length} allowlisted domain(s) or public suffix(es): ${rejected.join(", ")}`);
}

const existing = listBannedDomains();
const missing = accepted.filter((domain) => !existing.has(domain));
console.log(
	`${feed.source}: ${candidateLines.length} line(s), ${domains.length} domain(s), ${missing.length} not yet banned.`
);

if (!confirmed) {
	for (const domain of missing) console.log(`Would ban ${domain}`);
	console.log("Dry run. Re-run with --yes to write these bans.");
	process.exit(0);
}

if (missing.length > 0) {
	const directory = mkdtempSync(join(tmpdir(), "uwu-seed-feed-"));
	try {
		const filename = join(directory, "bans.json");
		writeFileSync(
			filename,
			JSON.stringify(missing.map((domain) => ({ key: `banned:${domain}`, value: feed.source })))
		);
		runWrangler(["kv", "bulk", "put", filename, "--binding", "UWU", "--remote"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

// After the keys, as in `pnpm ban`, so nothing can be created behind the sweep.
// Sweeps every accepted domain, not just the new ones, so re-running finishes
// a sweep that failed after the keys were written.
let marked = 0;
for (const rows of linkPagesOnDomains(accepted)) {
	markForDeletion(rows);
	marked += rows.length;
}
console.log(`Banned ${missing.length} domain(s) as "${feed.source}"; marked ${marked} existing link(s) for deletion.`);

function parseOptions() {
	try {
		return parseArgs({
			allowPositionals: true,
			options: { file: { type: "string" }, yes: { type: "boolean", default: false } }
		});
	} catch {
		return null;
	}
}

async function fetchFeed(url) {
	const response = await fetch(url);
	if (!response.ok) {
		console.error(`Fetching ${url} failed: HTTP ${response.status}`);
		process.exit(1);
	}
	return response.text();
}

function listBannedDomains() {
	const result = spawnSync(
		"pnpm",
		["exec", "wrangler", "kv", "key", "list", "--binding", "UWU", "--prefix", "banned:", "--remote"],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" }
	);
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	try {
		const listed = JSON.parse(result.stdout);
		if (!Array.isArray(listed)) throw new Error("expected an array");
		return new Set(
			listed.flatMap((entry) =>
				typeof entry?.name === "string" && entry.name.startsWith("banned:")
					? [entry.name.slice("banned:".length)]
					: []
			)
		);
	} catch (error) {
		throw new Error(`Wrangler returned invalid KV key list JSON: ${error.message}`);
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
