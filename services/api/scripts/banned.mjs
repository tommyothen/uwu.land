import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkPagesOnDomain, markForDeletion, parseBannableDomain, parseHostname } from "./domain-sweep.mjs";

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
// key that predates this check. The parsed form is lowercase punycode, which is
// what isBannedHostname looks up.
const domain = action === "ban" ? parseBannableDomain(argument) : null;
if (action === "ban" && domain === null) {
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
	runWrangler(["kv", "key", "put", "--binding", "UWU", `banned:${domain}`, "1", "--remote"]);
	// The key only blocks new links. Sweeping after it is written means nothing
	// can be created behind the sweep, and the reconciler re-checks bans before
	// publishing anything that was mid-create while it ran.
	let marked = 0;
	for (const rows of linkPagesOnDomain(domain)) {
		markForDeletion(rows);
		marked += rows.length;
	}
	console.log(`Banned ${domain}; marked ${marked} existing link(s) for deletion.`);
} else {
	// `ban` writes the normalised key, so that is the one that matters. The raw
	// argument goes too, unguarded, so a mixed-case or unicode legacy key that
	// predates normalising stays deletable.
	const normalised = parseHostname(argument);
	if (normalised !== null) {
		runWrangler(["kv", "key", "delete", "--binding", "UWU", `banned:${normalised}`, "--remote"]);
	}
	if (normalised !== argument) {
		runWrangler(["kv", "key", "delete", "--binding", "UWU", `banned:${argument}`, "--remote"]);
	}
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
				values.set(key, bulkValue(result));
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}

	return values;
}

// `wrangler kv bulk get` returns plain strings (`{"banned:x": "1"}`); older
// versions wrapped each one as `{ value }`. Accepts either.
function bulkValue(result) {
	if (typeof result === "string") return result;
	return typeof result?.value === "string" ? result.value : null;
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
