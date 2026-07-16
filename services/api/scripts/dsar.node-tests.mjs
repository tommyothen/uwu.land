import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	billingIncompleteReasons,
	CONTEXT,
	DELETION_RECORD_COPY,
	emailIdentityHash,
	fetchAllStripeInvoices,
	formatTimestamp,
	isClerkUserId,
	isStripeCustomerId,
	NO_DATA_COPY,
	normalizeEmail,
	tombstonePurgeDate
} from "./dsar.mjs";

const scriptPath = fileURLToPath(new URL("./dsar.mjs", import.meta.url));

test("dsar.mjs rejects invalid usage before running Wrangler", () => {
	for (const args of [
		[],
		["not-an-email"],
		["a@b.com", "extra"],
		["--allow-incomplete"]
	]) {
		const result = spawnSync(process.execPath, [scriptPath, ...args], {
			encoding: "utf8"
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Usage:/);
	}
});

test("dsar.mjs accepts --allow-incomplete alongside the email", () => {
	const env = { ...process.env };
	delete env.CLERK_SECRET_KEY;
	// Getting past argument parsing to the Clerk key check proves the flag
	// parsed as a flag rather than as a second positional argument.
	const result = spawnSync(
		process.execPath,
		[scriptPath, "a@b.com", "--allow-incomplete"],
		{ encoding: "utf8", env }
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /CLERK_SECRET_KEY is not set/);
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

test("formatTimestamp converts D1 second values and passes null through", () => {
	assert.equal(formatTimestamp(1784073600), "2026-07-15T00:00:00.000Z");
	assert.equal(formatTimestamp(null), null);
	assert.equal(formatTimestamp(undefined), null);
	assert.equal(formatTimestamp("not-a-number"), null);
});

test("tombstonePurgeDate adds the 30-day retention window in seconds", () => {
	assert.equal(tombstonePurgeDate(1784073600), "2026-08-14T00:00:00.000Z");
});

test("fetchAllStripeInvoices walks every page via starting_after", async () => {
	const invoice = (id) => ({ id });
	const pages = new Map([
		[
			"invoices?customer=cus_paged&limit=100",
			{ data: [invoice("in_1"), invoice("in_2")], has_more: true }
		],
		[
			"invoices?customer=cus_paged&limit=100&starting_after=in_2",
			{ data: [invoice("in_3")], has_more: true }
		],
		[
			"invoices?customer=cus_paged&limit=100&starting_after=in_3",
			{ data: [invoice("in_4")], has_more: false }
		]
	]);
	const requested = [];
	const fetchPage = async (path, stripeKey) => {
		assert.equal(stripeKey, "sk_test_paged");
		requested.push(path);
		const page = pages.get(path);
		assert.notEqual(page, undefined, `unexpected page request: ${path}`);
		return page;
	};

	const invoices = await fetchAllStripeInvoices(
		"cus_paged",
		"sk_test_paged",
		fetchPage
	);

	assert.deepEqual(
		invoices.map(({ id }) => id),
		["in_1", "in_2", "in_3", "in_4"]
	);
	assert.equal(requested.length, 3);
});

test("fetchAllStripeInvoices stops on an empty page even if has_more lies", async () => {
	const invoices = await fetchAllStripeInvoices(
		"cus_empty",
		"sk_test_empty",
		async () => ({ data: [], has_more: true })
	);

	assert.deepEqual(invoices, []);
});

test("billingIncompleteReasons flags exactly the unfetchable Stripe cases", () => {
	assert.deepEqual(billingIncompleteReasons(null, undefined), []);
	assert.deepEqual(billingIncompleteReasons(null, "sk_test_x"), []);
	assert.deepEqual(billingIncompleteReasons("cus_ABC123", "sk_test_x"), []);

	const noKey = billingIncompleteReasons("cus_ABC123", undefined);
	assert.equal(noKey.length, 1);
	assert.match(noKey[0], /STRIPE_SECRET_KEY is not set/);

	const emptyKey = billingIncompleteReasons("cus_ABC123", "");
	assert.equal(emptyKey.length, 1);
	assert.match(emptyKey[0], /STRIPE_SECRET_KEY is not set/);

	const badId = billingIncompleteReasons("cus_bad id", "sk_test_x");
	assert.equal(badId.length, 1);
	assert.match(badId[0], /customer id looks wrong/);
});

// The context block ships to the person who asked for their data. Keep it
// free of the em/en dashes and placeholder text the humanizer pass removes.
test("requester-facing copy stays plain", () => {
	const copy = [
		...Object.values(CONTEXT),
		DELETION_RECORD_COPY,
		NO_DATA_COPY,
		...billingIncompleteReasons("cus_ABC123", undefined),
		...billingIncompleteReasons("cus_bad id", "sk_test_x")
	];
	for (const line of copy) {
		assert.doesNotMatch(line, /[—–]/, `em/en dash in: ${line}`);
		assert.doesNotMatch(line, /TODO|placeholder|lorem/i, `draft text in: ${line}`);
	}
});
