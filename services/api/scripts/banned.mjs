import { spawnSync } from "node:child_process";

const [action, domain] = process.argv.slice(2);

if (
	(action !== "ban" && action !== "unban" && action !== "list") ||
	((action === "ban" || action === "unban") && domain === undefined) ||
	(action === "list" && domain !== undefined)
) {
	console.error("Usage: banned.mjs <ban DOMAIN | unban DOMAIN | list>");
	process.exit(1);
}

if (action === "list") {
	runWrangler(["kv", "key", "list", "--binding", "UWU", "--prefix", "banned:", "--remote"]);
} else if (action === "ban") {
	runWrangler(["kv", "key", "put", "--binding", "UWU", `banned:${domain}`, "1", "--remote"]);
} else {
	runWrangler(["kv", "key", "delete", "--binding", "UWU", `banned:${domain}`, "--remote"]);
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
