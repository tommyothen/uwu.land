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

for (const suffix of ["com", "co.uk", "pages.dev", "https://evil.example/path"]) {
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

// Runs a script against a stub `pnpm` on PATH: the real command would hit
// production. The stub answers D1 reads with `rows` and echoes every other
// invocation, so stdout shows each write the script would have made.
function runWithStub(script, args, rows = []) {
	const directory = mkdtempSync(join(tmpdir(), "uwu-maintenance-stub-"));
	try {
		writeFileSync(
			join(directory, "pnpm"),
			'#!/bin/sh\ncase "$*" in *--json*) printf "%s" "$STUB_D1_JSON" ;; *) echo "$@" ;; esac\n',
			{ mode: 0o755 }
		);
		return spawnSync(process.execPath, [scriptsDirectory + script, ...args], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${directory}:${process.env.PATH}`,
				STUB_D1_JSON: JSON.stringify([{ results: rows }])
			}
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

const stubOptions = { skip: process.platform === "win32" };

// isBannedHostname only ever looks up lowercase punycode keys, so any other
// spelling would write a key that can never match.
test("banned.mjs writes the hostname the worker sees", stubOptions, () => {
	const lowered = runWithStub("banned.mjs", ["ban", "EVIL.Example.com"]);
	assert.equal(lowered.status, 0);
	assert.match(lowered.stdout, /banned:evil\.example\.com /);

	const unicode = runWithStub("banned.mjs", ["ban", "пример.рф"]);
	assert.equal(unicode.status, 0);
	assert.match(unicode.stdout, /banned:xn--e1afmkfd\.xn--p1ai /);
});

const domainRows = [
	{ slug: "apex", url: "https://evil.example/a" },
	{ slug: "sub", url: "https://www.evil.example/b" },
	{ slug: "lookalike", url: "https://evil.example.org/c" },
	{ slug: "mention", url: "https://safe.example/?next=evil.example" }
];

test("banned.mjs hands existing links on the domain to the reconciler", stubOptions, () => {
	const result = runWithStub("banned.mjs", ["ban", "evil.example"], domainRows);
	assert.equal(result.status, 0);
	const update = result.stdout.split("\n").find((line) => line.includes("UPDATE links"));
	assert.match(update ?? "", /lifecycle_state = 'pending_delete' WHERE slug IN \('apex', 'sub'\)/);
});

test("purge-domain.mjs only reports without --yes", stubOptions, () => {
	const dryRun = runWithStub("purge-domain.mjs", ["evil.example"], domainRows);
	assert.equal(dryRun.status, 0);
	assert.match(dryRun.stdout, /Would delete apex/);
	assert.doesNotMatch(dryRun.stdout, /UPDATE links|lookalike|mention/);

	const confirmed = runWithStub("purge-domain.mjs", ["evil.example", "--yes"], domainRows);
	assert.equal(confirmed.status, 0);
	assert.match(confirmed.stdout, /WHERE slug IN \('apex', 'sub'\)/);
});
