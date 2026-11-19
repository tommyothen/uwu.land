import { spawnSync } from "node:child_process";

// Suspends or unsuspends one account by Clerk user id. A suspended account can
// still sign in, list and delete its links, but every create is refused (see
// createLink in src/links.ts). Its existing links stay up; use
// `pnpm purge:owner <userId>` to take them down. Always runs against
// production (--remote).

const [action, userId, ...rest] = process.argv.slice(2);

// wrangler's CLI has no bound parameters, so the id must match a strict shape
// before it is interpolated into SQL.
if (
	(action !== "suspend" && action !== "unsuspend") ||
	rest.length !== 0 ||
	typeof userId !== "string" ||
	!/^user_[A-Za-z0-9]+$/.test(userId)
) {
	console.error("Usage: suspend.mjs <suspend | unsuspend> USER_ID (a Clerk id, user_...)");
	process.exit(1);
}

// coalesce keeps the original suspension time if the account is suspended twice.
const sql =
	action === "suspend"
		? `UPDATE users SET suspended_at = coalesce(suspended_at, unixepoch()) WHERE id = '${userId}'`
		: `UPDATE users SET suspended_at = NULL WHERE id = '${userId}'`;
const changes = d1Changes(sql);

if (changes === 0) {
	console.error(`No user found with id ${userId}.`);
	process.exit(1);
}
console.log(`${action === "suspend" ? "Suspended" : "Unsuspended"} ${userId}.`);

function d1Changes(command) {
	const result = spawnSync(
		"pnpm",
		["exec", "wrangler", "d1", "execute", "uwu-land", "--remote", "--json", "--command", command],
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
		return payload.reduce((total, entry) => total + Number(entry?.meta?.changes ?? 0), 0);
	} catch (error) {
		throw new Error(`Wrangler returned invalid D1 JSON: ${error.message}`);
	}
}
