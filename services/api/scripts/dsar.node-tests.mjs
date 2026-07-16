import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CONTEXT,
	DELETION_RECORD_COPY,
	emailIdentityHash,
	formatTimestamp,
	isClerkUserId,
	isStripeCustomerId,
	NO_DATA_COPY,
	normalizeEmail,
	tombstonePurgeDate
} from "./dsar.mjs";

const scriptPath = fileURLToPath(new URL("./dsar.mjs", import.meta.url));

test("dsar.mjs rejects invalid usage before running Wrangler", () => {
	for (const args of [[], ["not-an-email"], ["a@b.com", "extra"]]) {
		const result = spawnSync(process.execPath, [scriptPath, ...args], {
			encoding: "utf8"
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Usage:/);
	}
});

test("dsar.mjs requires CLERK_SECRET_KEY before doing anything", () => {
	const env = { ...process.env };
	delete env.CLERK_SECRET_KEY;
	const result = spawnSync(process.execPath, [scriptPath, "a@b.com"], {
		encoding: "utf8",
		env
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /CLERK_SECRET_KEY is not set/);
});

// These vectors mirror src/identity.ts. If normalization changes there,
// this test must fail until dsar.mjs is updated to match.
test("normalizeEmail matches the identity.ts rules", () => {
	assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
	assert.equal(normalizeEmail("foo+tag@example.com"), "foo@example.com");
	assert.equal(normalizeEmail("f.o.o+x@gmail.com"), "foo@gmail.com");
	assert.equal(normalizeEmail("f.o.o@googlemail.com"), "foo@googlemail.com");
	assert.equal(normalizeEmail("dots.kept@example.com"), "dots.kept@example.com");
	assert.equal(normalizeEmail("no-at-sign"), "no-at-sign");
});

test("emailIdentityHash hashes the normalized form", () => {
	const expected = createHash("sha256")
		.update("user@example.com", "utf8")
		.digest("hex");
	assert.equal(emailIdentityHash("  USER+anything@Example.com "), expected);
});

test("identifier guards accept real shapes and reject SQL smuggling", () => {
	assert.equal(isClerkUserId("user_2abcDEF123"), true);
	assert.equal(isClerkUserId("user_2abc'; DROP TABLE users;--"), false);
	assert.equal(isClerkUserId("usr_2abc"), false);
	assert.equal(isStripeCustomerId("cus_ABC123"), true);
	assert.equal(isStripeCustomerId("cus_ABC 123"), false);
});

test("formatTimestamp converts millisecond values and passes null through", () => {
	assert.equal(formatTimestamp(1784073600000), "2026-07-15T00:00:00.000Z");
	assert.equal(formatTimestamp(null), null);
	assert.equal(formatTimestamp(undefined), null);
	assert.equal(formatTimestamp("not-a-number"), null);
});

test("tombstonePurgeDate adds the 30-day retention window", () => {
	assert.equal(tombstonePurgeDate(1784073600000), "2026-08-14T00:00:00.000Z");
});

// The context block ships to the person who asked for their data. Keep it
// free of the em/en dashes and placeholder text the humanizer pass removes.
test("requester-facing copy stays plain", () => {
	const copy = [...Object.values(CONTEXT), DELETION_RECORD_COPY, NO_DATA_COPY];
	for (const line of copy) {
		assert.doesNotMatch(line, /[—–]/, `em/en dash in: ${line}`);
		assert.doesNotMatch(line, /TODO|placeholder|lorem/i, `draft text in: ${line}`);
	}
});
