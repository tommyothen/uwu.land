import { spawnSync } from "node:child_process";

const days = parseDays(process.argv.slice(2));
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

function parseDays(args) {
	if (args.length === 0) return 7;
	if (args.length === 2 && args[0] === "--days" && /^\d+$/.test(args[1])) {
		const value = Number(args[1]);
		if (value > 0) return value;
	}
	console.error("Usage: abuse-top.mjs [--days N] (N must be a positive integer)");
	process.exit(1);
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
