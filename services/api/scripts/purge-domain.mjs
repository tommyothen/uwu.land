import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const domains = args.filter((arg) => arg !== "--yes");
if (domains.length !== 1) {
	console.error("Usage: purge-domain.mjs DOMAIN [--yes]");
	process.exit(1);
}

const domain = normalizeDomain(domains[0]);
const rows = d1Rows(
	`SELECT slug, url FROM links WHERE lower(url) LIKE '%${sqlLiteral(domain)}%'`
).filter((row) => typeof row.slug === "string" && matchesDomain(row.url, domain));

if (rows.length === 0) {
	console.log(`No links found for ${domain}.`);
	process.exit(0);
}

for (const row of rows) {
	if (!confirmed) {
		console.log(`Would delete ${row.slug} (${row.url})`);
		continue;
	}
	console.log(`Deleting ${row.slug} (${row.url})`);
	runWrangler(["d1", "execute", "uwu-land", "--remote", "--command", `DELETE FROM links WHERE slug = '${sqlLiteral(row.slug)}'`]);
	runWrangler(["kv", "key", "delete", "--binding", "UWU", row.slug, "--remote"]);
	runWrangler(["kv", "key", "delete", "--binding", "CLICKS", row.slug, "--remote"]);
}

function normalizeDomain(value) {
	try {
		const hostname = new URL(`https://${value}`).hostname.toLowerCase();
		if (hostname === "" || hostname !== value.toLowerCase().replace(/\.$/, "")) {
			throw new Error("not a hostname");
		}
		return hostname;
	} catch {
		console.error("Usage: purge-domain.mjs DOMAIN [--yes] (DOMAIN must be a hostname)");
		process.exit(1);
	}
}

function matchesDomain(url, domain) {
	if (typeof url !== "string") return false;
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		return hostname === domain || hostname.endsWith(`.${domain}`);
	} catch {
		return false;
	}
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
