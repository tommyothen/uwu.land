import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Public suffixes that survive the "must contain a dot" rule. isBannedHostname
 * refuses to match a bare final label, so `ban com` is inert there, but a
 * two-label suffix like `co.uk` still matches every domain registered under it.
 */
const PUBLIC_SUFFIXES = new Set([
	"ac.uk", "co.uk", "gov.uk", "me.uk", "net.uk", "org.uk", "sch.uk",
	"com.au", "edu.au", "gov.au", "net.au", "org.au",
	"co.nz", "net.nz", "org.nz",
	"co.za", "org.za",
	"co.jp", "ne.jp", "or.jp",
	"com.br", "com.mx", "com.ar", "com.co", "com.pe",
	"com.cn", "com.hk", "com.sg", "com.my", "com.ph", "com.vn", "com.tw",
	"co.in", "co.id", "co.il", "co.kr", "co.th",
	"com.tr", "com.ua", "com.pl", "com.ru", "com.es", "com.pt", "com.gr"
]);

const [action, argument] = process.argv.slice(2);

if (
	(action !== "ban" && action !== "unban" && action !== "list") ||
	((action === "ban" || action === "unban") && argument === undefined) ||
	(action === "list" &&
		argument !== undefined &&
		argument !== "--auto" &&
		argument !== "--manual")
) {
	console.error(
		"Usage: banned.mjs <ban DOMAIN | unban DOMAIN | list [--auto | --manual]>"
	);
	process.exit(1);
}

// Guards `ban` only. `unban` has to stay open so an operator can delete a bad
// key that predates this check.
if (action === "ban" && !isBannableDomain(argument)) {
	console.error(
		`Refusing to ban "${argument}": pass a full domain (e.g. evil.example.com). A bare public suffix would target every domain under it.`
	);
	process.exit(1);
}

if (action === "list" && argument === undefined) {
	runWrangler(["kv", "key", "list", "--binding", "UWU", "--prefix", "banned:", "--remote"]);
} else if (action === "list") {
	listBySource(argument === "--auto" ? "auto" : "manual");
} else if (action === "ban") {
	// Lowercased because isBannedHostname only looks up lowercase keys; unban
	// keeps the raw argument so a mixed-case legacy key stays deletable.
	runWrangler(["kv", "key", "put", "--binding", "UWU", `banned:${argument.toLowerCase()}`, "1", "--remote"]);
} else {
	runWrangler(["kv", "key", "delete", "--binding", "UWU", `banned:${argument}`, "--remote"]);
}

function isBannableDomain(domain) {
	const lowered = domain.toLowerCase();
	return (
		/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(lowered) && !PUBLIC_SUFFIXES.has(lowered)
	);
}

function listBySource(source) {
	const listed = runWranglerCapture([
		"kv",
		"key",
		"list",
		"--binding",
		"UWU",
		"--prefix",
		"banned:",
		"--remote"
	]);
	const keys = parseListedKeys(listed);
	const values = getValuesInBatches(keys);
	const matches = keys
		.map((name) => ({ name, value: values.get(name) ?? null }))
		.filter(({ value }) =>
			source === "auto" ? value === "auto" : value !== null && value !== "auto"
		);

	console.log(JSON.stringify(matches, null, 2));
}

function parseListedKeys(output) {
	try {
		const listed = JSON.parse(output);
		if (!Array.isArray(listed)) throw new Error("expected an array");
		return listed.flatMap((entry) =>
			typeof entry?.name === "string" ? [entry.name] : []
		);
	} catch (error) {
		throw new Error(`Wrangler returned invalid KV key list JSON: ${error.message}`);
	}
}

function getValuesInBatches(keys) {
	const values = new Map();
	const directory = mkdtempSync(join(tmpdir(), "uwu-banned-"));

	try {
		for (let index = 0; index < keys.length; index += 100) {
			const filename = join(directory, `${index}.json`);
			writeFileSync(filename, JSON.stringify(keys.slice(index, index + 100)));
			const output = runWranglerCapture([
				"kv",
				"bulk",
				"get",
				filename,
				"--binding",
				"UWU",
				"--remote"
			]);
			for (const [key, result] of Object.entries(parseBulkValues(output))) {
				values.set(key, result?.value ?? null);
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}

	return values;
}

function parseBulkValues(output) {
	try {
		const values = JSON.parse(output);
		if (values === null || typeof values !== "object" || Array.isArray(values)) {
			throw new Error("expected an object");
		}
		return values;
	} catch (error) {
		throw new Error(`Wrangler returned invalid KV bulk get JSON: ${error.message}`);
	}
}

function runWrangler(args) {
	const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
		stdio: "inherit",
		shell: process.platform === "win32"
	});
	if (result.error !== undefined) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function runWranglerCapture(args) {
	const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
		encoding: "utf8",
		shell: process.platform === "win32"
	});
	if (result.error !== undefined) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	return result.stdout;
}
