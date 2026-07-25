import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

for (const suffix of ["com", "co.uk", "https://evil.example/path"]) {
	test(`banned.mjs refuses to ban "${suffix}" before running Wrangler`, () => {
		const result = spawnSync(
			process.execPath,
			[`${scriptsDirectory}banned.mjs`, "ban", suffix],
			{ encoding: "utf8" }
		);

		assert.equal(result.status, 1);
		assert.match(result.stderr, /Refusing to ban/);
	});
}

// isBannedHostname only ever looks up lowercase keys, so a mixed-case ban would
// write a key that can never match. Runs against a stub on PATH: the real
// command would write to production KV.
test(
	"banned.mjs writes a lowercase KV key",
	{ skip: process.platform === "win32" },
	() => {
		const directory = mkdtempSync(join(tmpdir(), "uwu-banned-stub-"));
		try {
			writeFileSync(join(directory, "pnpm"), '#!/bin/sh\necho "$@"\n', {
				mode: 0o755
			});
			const result = spawnSync(
				process.execPath,
				[`${scriptsDirectory}banned.mjs`, "ban", "EVIL.Example.com"],
				{
					encoding: "utf8",
					env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }
				}
			);

			assert.equal(result.status, 0);
			assert.match(result.stdout, /banned:evil\.example\.com/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
);
