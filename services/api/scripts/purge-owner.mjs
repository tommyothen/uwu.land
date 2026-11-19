import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Takes down every link belonging to one owner: a live account by Clerk user
// id, or a deleted one by the deleted_owner_hash shown in
// `pnpm abuse:top --by owner`. A user id also matches the links it left behind
// if the account has since been deleted. Rows are marked pending_delete and
// the scheduled reconciler removes them from KV and D1. Dry run unless --yes.
// Always runs against production (--remote).

// Rows listed per D1 query in a dry run. URLs are capped at 2048 characters
// on input, so a page of them stays well inside D1_MAX_BUFFER.
const PAGE_SIZE = 200;
const D1_MAX_BUFFER = 16 * 1024 * 1024;

// Mirrors DELETED_OWNER_HASH_PREFIX and deletedOwnerHash in
// src/clerk-webhook.ts; keep the two in sync. The tests pin the same vector on
// both sides so drift fails CI.
const DELETED_OWNER_HASH_PREFIX = "uwu.land:deleted-owner:v1:";

export function deletedOwnerHash(userId) {
	return createHash("sha256")
		.update(`${DELETED_OWNER_HASH_PREFIX}${userId}`, "utf8")
		.digest("hex");
}

// Returns the SQL condition selecting the owner's links, or null when the
// argument is neither a Clerk user id nor an owner hash. Both shapes are
// checked strictly because wrangler's CLI has no bound parameters.
export function ownerCondition(owner) {
	if (/^user_[A-Za-z0-9]+$/.test(owner)) {
		return `(owner_id = '${owner}' OR deleted_owner_hash = '${deletedOwnerHash(owner)}')`;
	}
	if (/^[0-9a-f]{64}$/.test(owner)) {
		return `deleted_owner_hash = '${owner}'`;
	}
	return null;
}

function main() {
	const args = process.argv.slice(2);
	const confirmed = args.includes("--yes");
	const owners = args.filter((arg) => arg !== "--yes");
	const condition = owners.length === 1 ? ownerCondition(owners[0]) : null;
	if (condition === null) {
		console.error("Usage: purge-owner.mjs <USER_ID | OWNER_HASH> [--yes]");
		process.exit(1);
	}

	const where = `${condition} AND lifecycle_state != 'pending_delete'`;
	if (confirmed) {
		// One UPDATE returns no rows, so it stays bounded however many links the
		// owner has, and meta.changes is the exact count it marked.
		const marked = d1Changes(`UPDATE links SET lifecycle_state = 'pending_delete' WHERE ${where}`);
		if (marked === 0) {
			console.log(`No live links found for ${owners[0]}.`);
			return;
		}
		// The five-minute cron reconciles up to 100 pending rows per run.
		console.log(
			`Marked ${marked} link(s) for deletion. The scheduled reconciler removes about 100 every five minutes.`
		);
		return;
	}

	// Dry run: list a page at a time, keyset paginated on slug, so a large
	// owner never has to fit in one Wrangler response.
	let found = 0;
	let after = "";
	for (;;) {
		const page = d1Rows(
			`SELECT slug, url FROM links WHERE ${where} AND slug > '${after.replaceAll("'", "''")}' ORDER BY slug LIMIT ${PAGE_SIZE}`
		);
		for (const row of page) console.log(`Would delete ${row.slug} (${row.url})`);
		found += page.length;
		const last = page.at(-1)?.slug;
		if (page.length < PAGE_SIZE || typeof last !== "string") break;
		after = last;
	}
	console.log(
		found === 0
			? `No live links found for ${owners[0]}.`
			: `${found} link(s). Run again with --yes to delete them.`
	);
}

function d1Rows(sql) {
	return d1Execute(sql).flatMap((entry) => (Array.isArray(entry.results) ? entry.results : []));
}

function d1Changes(sql) {
	return d1Execute(sql).reduce((total, entry) => total + Number(entry?.meta?.changes ?? 0), 0);
}

function d1Execute(sql) {
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
		return payload;
	} catch (error) {
		throw new Error(`Wrangler returned invalid D1 JSON: ${error.message}`);
	}
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
