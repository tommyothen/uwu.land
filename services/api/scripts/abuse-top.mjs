import { spawnSync } from "node:child_process";

const { days, by } = parseArgs(process.argv.slice(2));
if (by === "owner") {
	topOwners(days);
} else {
	topDomains(days);
}

// Default view: links created in the window, grouped by destination hostname.
function topDomains(days) {
	const sql = `SELECT url, source, created_at AS createdAt FROM links WHERE created_at >= unixepoch('now') - ${days} * 86400`;
	const rows = d1Rows(sql);
	const totals = new Map();

	for (const row of rows) {
		if (typeof row.url !== "string") continue;
		try {
			const hostname = new URL(row.url).hostname.toLowerCase();
			const current = totals.get(hostname) ?? {
				hostname,
				totalLinks: 0,
				anonLinks: 0,
				newestCreatedAt: null
			};
			current.totalLinks += 1;
			if (row.source === "web-anon") current.anonLinks += 1;
			const createdAt = new Date(Number(row.createdAt) * 1000);
			if (!Number.isNaN(createdAt.getTime())) {
				const iso = createdAt.toISOString();
				if (current.newestCreatedAt === null || iso > current.newestCreatedAt) {
					current.newestCreatedAt = iso;
				}
			}
			totals.set(hostname, current);
		} catch {
			console.error(`Skipping malformed stored URL: ${row.url}`);
		}
	}

	console.table(
		[...totals.values()].sort(
			(a, b) => b.totalLinks - a.totalLinks || a.hostname.localeCompare(b.hostname)
		)
	);
}

// `--by owner`: links created in the window, grouped by account. A live
// account shows its Clerk user id; a deleted one shows its deleted_owner_hash.
// Either value can be passed straight to `pnpm purge:owner`. Anonymous links
// have neither and are left to the default view.
function topOwners(days) {
	const rows = d1Rows(
		`SELECT coalesce(l.owner_id, l.deleted_owner_hash) AS owner,
			CASE WHEN l.owner_id IS NULL THEN 'deleted' WHEN u.suspended_at IS NOT NULL THEN 'suspended' ELSE 'active' END AS account,
			COUNT(*) AS totalLinks,
			MAX(l.created_at) AS newestCreatedAt
		FROM links l LEFT JOIN users u ON u.id = l.owner_id
		WHERE l.created_at >= unixepoch('now') - ${days} * 86400
			AND (l.owner_id IS NOT NULL OR l.deleted_owner_hash IS NOT NULL)
		GROUP BY l.owner_id, l.deleted_owner_hash
		ORDER BY totalLinks DESC, owner`
	);
	console.table(
		rows.map((row) => ({
			...row,
			newestCreatedAt: new Date(Number(row.newestCreatedAt) * 1000).toISOString()
		}))
	);
}

function parseArgs(args) {
	const options = { days: 7, by: "domain" };
	for (let index = 0; index < args.length; index += 2) {
		const [flag, value] = [args[index], args[index + 1]];
		if (flag === "--days" && /^\d+$/.test(value ?? "") && Number(value) > 0) {
			options.days = Number(value);
		} else if (flag === "--by" && (value === "domain" || value === "owner")) {
			options.by = value;
		} else {
			console.error(
				"Usage: abuse-top.mjs [--days N] [--by domain|owner] (N must be a positive integer)"
			);
			process.exit(1);
		}
	}
	return options;
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
