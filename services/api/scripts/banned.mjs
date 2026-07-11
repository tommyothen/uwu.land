import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

if (action === "list" && argument === undefined) {
	runWrangler(["kv", "key", "list", "--binding", "UWU", "--prefix", "banned:", "--remote"]);
} else if (action === "list") {
	listBySource(argument === "--auto" ? "auto" : "manual");
} else if (action === "ban") {
	runWrangler(["kv", "key", "put", "--binding", "UWU", `banned:${argument}`, "1", "--remote"]);
} else {
	runWrangler(["kv", "key", "delete", "--binding", "UWU", `banned:${argument}`, "--remote"]);
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
