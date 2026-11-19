import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deletedOwnerHash, ownerCondition } from "./purge-owner.mjs";

const scriptsDirectory = fileURLToPath(new URL("./", import.meta.url));

for (const [script, args] of [
	["banned.mjs", []],
	["abuse-top.mjs", ["--days", "0"]],
	["abuse-top.mjs", ["--by", "email"]],
	["abuse-top.mjs", ["--days"]],
	["purge-domain.mjs", []],
	["purge-owner.mjs", []],
	["purge-owner.mjs", ["user_x'; DROP TABLE links; --"]],
	["purge-owner.mjs", ["user_a", "user_b"]],
	["suspend.mjs", ["suspend"]],
	["suspend.mjs", ["suspend", "not-a-clerk-id"]],
	["suspend.mjs", ["delete", "user_abc"]]
]) {
	test(`${script} rejects invalid usage before running Wrangler`, () => {
		const result = spawnSync(process.execPath, [scriptsDirectory + script, ...args], {
			encoding: "utf8"
		});

		assert.equal(result.status, 1);
		assert.match(result.stderr, /Usage:/);
	});
}

// Pinned in test/clerk-webhook.test.ts too, so the worker and this script
// always agree on which links a user id owned before deletion.
test("purge-owner.mjs hashes user ids the same way the Clerk webhook does", () => {
	assert.equal(
		deletedOwnerHash("user_deleted"),
		"bdf7a361d35f261bb56ef3885c415230222a127440310357e72d057cb4367e0a"
	);
});

test("purge-owner.mjs matches a user id's live and deleted links, a hash only its deleted ones", () => {
	const hash = deletedOwnerHash("user_abc");
	assert.equal(
		ownerCondition("user_abc"),
		`(owner_id = 'user_abc' OR deleted_owner_hash = '${hash}')`
	);
	assert.equal(ownerCondition(hash), `deleted_owner_hash = '${hash}'`);
	assert.equal(ownerCondition(hash.toUpperCase()), null);
});

// co.ke and *.ck are on the Public Suffix List but were never in a hand-written
// list; github.io and pages.dev are private suffixes, refused all the same.
for (const suffix of ["com", "co.uk", "co.ke", "anything.ck", "github.io", "pages.dev", "https://evil.example/path"]) {
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

test("banned.mjs bans a single site under a public suffix", stubOptions, () => {
	for (const domain of ["customer.co.ke", "someone.github.io"]) {
		const result = runWithStub("banned.mjs", ["ban", domain]);
		assert.equal(result.status, 0);
		assert.match(result.stdout, new RegExp(`banned:${domain.replaceAll(".", "\\.")} `));
	}
});

test("banned.mjs unban deletes the key ban wrote and the raw legacy key", stubOptions, () => {
	const result = runWithStub("banned.mjs", ["unban", "Bücher.de"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /key delete --binding UWU banned:xn--bcher-kva\.de /);
	assert.match(result.stdout, /key delete --binding UWU banned:Bücher\.de /);

	// Legacy keys skip the public suffix guard, and one spelling deletes once.
	const suffix = runWithStub("banned.mjs", ["unban", "co.ke"]);
	assert.equal(suffix.status, 0);
	assert.equal(suffix.stdout.match(/key delete/g)?.length, 1);
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
	// Each slug is matched with the URL that was read, so a reused slug is spared.
	assert.match(
		update ?? "",
		/\(slug = 'apex' AND url = 'https:\/\/evil\.example\/a'\) OR \(slug = 'sub' AND url = 'https:\/\/www\.evil\.example\/b'\)\)/
	);
	assert.doesNotMatch(update ?? "", /lookalike|mention/);
});

test("purge-domain.mjs only reports without --yes", stubOptions, () => {
	const dryRun = runWithStub("purge-domain.mjs", ["evil.example"], domainRows);
	assert.equal(dryRun.status, 0);
	assert.match(dryRun.stdout, /Would delete apex/);
	assert.doesNotMatch(dryRun.stdout, /UPDATE links|lookalike|mention/);

	const confirmed = runWithStub("purge-domain.mjs", ["evil.example", "--yes"], domainRows);
	assert.equal(confirmed.status, 0);
	assert.match(confirmed.stdout, /UPDATE links .*slug = 'apex' .*slug = 'sub'/);
});
