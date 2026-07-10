import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL("./", import.meta.url));

for (const [script, args] of [
	["banned.mjs", []],
	["abuse-top.mjs", ["--days", "0"]],
	["purge-domain.mjs", []]
]) {
	test(`${script} rejects invalid usage before running Wrangler`, () => {
		const result = spawnSync(process.execPath, [scriptsDirectory + script, ...args], {
			encoding: "utf8"
		});

		assert.equal(result.status, 1);
		assert.match(result.stderr, /Usage:/);
	});
}
