import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Answers a GDPR subject access request for one email address: looks the
// person up in Clerk, pulls every row we hold in D1, optionally pulls billing
// detail from Stripe, and writes a single JSON file ready to send back.
// Always runs against production (--remote); a DSAR against dev data would be
// meaningless. Verify the requester controls the email before running this.

const TOMBSTONE_RETENTION_DAYS = 30;

// Wording that ships to the requester inside the export. Keep it in plain
// English and consistent with the privacy policy at apps/web/app/routes/privacy.tsx.
export const CONTEXT = {
	what_this_is:
		"Everything uwu.land holds about you, exported on the date above. The identity section comes from Clerk, our sign-in provider. The database section comes from our own records.",
	api_key_secrets:
		"API key secrets are stored only as one-way hashes. We cannot include them because we do not have them.",
	rate_limit_state:
		"Abuse and rate-limit counters expire on their own within about 24 hours, so there is no lasting record to export.",
	click_analytics:
		"Each click event holds three fields: the link slug, the visitor's country, and the hostname of the referring site. They contain no IP address and no user agent, and they are not tied to your account.",
	server_logs:
		"Cloudflare keeps short-lived operational logs so we can diagnose faults. These can include IP addresses, roll off within a few days, and cannot be searched by person.",
	policy: "https://uwu.land/privacy",
	contact: "hello@uwu.land"
};

export const DELETION_RECORD_COPY =
	"A one-way hash of your email address, kept for 30 days after account deletion so a closed account cannot be reopened to reset free-tier limits. It is deleted automatically after that.";

export const NO_DATA_COPY =
	"We hold no account and no data for this email address.";

// Mirrors normalizeEmail in src/identity.ts; keep the two in sync. The
// node-tests pin the same vectors so drift fails CI.
export function normalizeEmail(email) {
	const normalized = email.trim().toLowerCase();
	const at = normalized.lastIndexOf("@");
	const domain = at === -1 ? "" : normalized.slice(at + 1);
	let local = at === -1 ? normalized : normalized.slice(0, at);

	const plus = local.indexOf("+");
	if (plus !== -1) {
		local = local.slice(0, plus);
	}
	if (domain === "gmail.com" || domain === "googlemail.com") {
		local = local.replaceAll(".", "");
	}

	return at === -1 ? local : `${local}@${domain}`;
}

// Mirrors emailIdentityHash in src/identity.ts (unsalted SHA-256 hex).
export function emailIdentityHash(email) {
	return createHash("sha256").update(normalizeEmail(email), "utf8").digest("hex");
}

// Guards before embedding identifiers in SQL: wrangler's CLI has no bound
// parameters, so anything interpolated must match a strict shape first.
export function isClerkUserId(value) {
	return typeof value === "string" && /^user_[A-Za-z0-9]+$/.test(value);
}

export function isStripeCustomerId(value) {
	return typeof value === "string" && /^cus_[A-Za-z0-9]+$/.test(value);
}

// D1 timestamps are stored as integer seconds since the epoch (drizzle's
// mode: "timestamp"; every webhook writer binds whole seconds). Null stays
// null.
export function formatTimestamp(value) {
	if (value === null || value === undefined) return null;
	const date = new Date(Number(value) * 1000);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function tombstonePurgeDate(deletedAtSeconds) {
	return formatTimestamp(
		Number(deletedAtSeconds) + TOMBSTONE_RETENTION_DAYS * 86_400
	);
}

function parseArgs(args) {
	if (args.length === 1 && args[0].includes("@")) {
		return args[0];
	}
	console.error(
		"Usage: dsar.mjs <email>\nExports everything uwu.land holds for that address as a JSON file (a GDPR subject access request)."
	);
	process.exit(1);
}

function requireClerkKey() {
	const key = process.env.CLERK_SECRET_KEY;
	if (typeof key === "string" && key !== "") {
		return key;
	}
	console.error(
		"CLERK_SECRET_KEY is not set. Copy the secret key from the Clerk dashboard, then run:\n  CLERK_SECRET_KEY=sk_live_... pnpm dsar <email>"
	);
	process.exit(1);
}

async function findClerkUser(email, clerkKey) {
	const response = await fetch(
		`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
		{ headers: { Authorization: `Bearer ${clerkKey}` } }
	);
	if (!response.ok) {
		console.error(`Clerk lookup failed with status ${response.status}.`);
		process.exit(1);
	}
	const users = await response.json();
	if (!Array.isArray(users) || users.length === 0) {
		return null;
	}
	if (users.length > 1) {
		console.error(
			`Clerk returned ${users.length} users for this address. Resolve which one the request is about in the Clerk dashboard, then export manually.`
		);
		process.exit(1);
	}
	return users[0];
}

function d1Rows(sql) {
	const result = spawnSync(
		"pnpm",
		["exec", "wrangler", "d1", "execute", "uwu-land", "--remote", "--json", "--command", sql],
		{ encoding: "utf8", shell: process.platform === "win32" }
	);
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	try {
		return JSON.parse(result.stdout)[0].results;
	} catch {
		console.error("Could not parse the wrangler response:");
		process.stderr.write(result.stdout);
		process.exit(1);
	}
}

async function fetchStripe(path, stripeKey) {
	const response = await fetch(`https://api.stripe.com/v1/${path}`, {
		headers: { Authorization: `Bearer ${stripeKey}` }
	});
	if (!response.ok) {
		console.error(`Stripe request for ${path} failed with status ${response.status}.`);
		process.exit(1);
	}
	return response.json();
}

// Stripe list endpoints return at most 100 rows per call; walk every page so
// long billing histories export in full. fetchPage is injectable for tests.
export async function fetchAllStripeInvoices(
	customerId,
	stripeKey,
	fetchPage = fetchStripe
) {
	const invoices = [];
	let startingAfter = null;
	for (;;) {
		const cursor =
			startingAfter === null
				? ""
				: `&starting_after=${encodeURIComponent(startingAfter)}`;
		const page = await fetchPage(
			`invoices?customer=${customerId}&limit=100${cursor}`,
			stripeKey
		);
		const data = Array.isArray(page.data) ? page.data : [];
		invoices.push(...data);
		const last = data.at(-1);
		if (page.has_more !== true || last === undefined) {
			return invoices;
		}
		startingAfter = last.id;
	}
}

async function buildBilling(userId) {
	const customers = d1Rows(
		`SELECT customer_id, created_at FROM stripe_customers WHERE user_id = '${userId}'`
	);
	const subscriptions = d1Rows(
		`SELECT id, price_id, status FROM stripe_subscriptions WHERE user_id = '${userId}'`
	);
	const billing = {
		customer_id: customers[0]?.customer_id ?? null,
		customer_since: formatTimestamp(customers[0]?.created_at),
		subscriptions
	};

	const stripeKey = process.env.STRIPE_SECRET_KEY;
	const customerId = billing.customer_id;
	if (customerId === null) {
		return billing;
	}
	if (typeof stripeKey !== "string" || stripeKey === "") {
		console.error(
			"STRIPE_SECRET_KEY is not set, so invoices were not fetched from Stripe. Export them from the Stripe dashboard before replying."
		);
		return billing;
	}
	if (!isStripeCustomerId(customerId)) {
		console.error(`Skipping Stripe fetch: unexpected customer id ${customerId}.`);
		return billing;
	}
	console.error("Fetching billing data from Stripe…");
	billing.stripe_customer = await fetchStripe(`customers/${customerId}`, stripeKey);
	billing.stripe_invoices = await fetchAllStripeInvoices(customerId, stripeKey);
	return billing;
}

async function buildAccountExport(email, clerkUser) {
	const userId = clerkUser.id;
	if (!isClerkUserId(userId)) {
		console.error(`Clerk returned an unexpected user id: ${userId}`);
		process.exit(1);
	}

	console.error("Reading the database…");
	const accountRows = d1Rows(
		`SELECT id, tier, created_at, email_hash, limited_until FROM users WHERE id = '${userId}'`
	);
	const keyRows = d1Rows(
		`SELECT id, name, display_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = '${userId}' ORDER BY created_at`
	);
	const linkRows = d1Rows(
		`SELECT slug, url, external_ref, source, clicks, created_at FROM links WHERE owner_id = '${userId}' ORDER BY created_at`
	);

	const account = accountRows[0] ?? null;
	return {
		generated_at: new Date().toISOString(),
		requested_for: email,
		identity: clerkUser,
		database: {
			account:
				account === null
					? null
					: {
							id: account.id,
							tier: account.tier,
							created_at: formatTimestamp(account.created_at),
							email_hash: account.email_hash,
							limited_until: formatTimestamp(account.limited_until)
						},
			api_keys: keyRows.map((row) => ({
				id: row.id,
				name: row.name,
				display_prefix: row.display_prefix,
				created_at: formatTimestamp(row.created_at),
				last_used_at: formatTimestamp(row.last_used_at),
				revoked_at: formatTimestamp(row.revoked_at)
			})),
			links: linkRows.map((row) => ({
				slug: row.slug,
				short_url: `https://uwu.land/${row.slug}`,
				url: row.url,
				external_ref: row.external_ref,
				source: row.source,
				clicks: row.clicks,
				created_at: formatTimestamp(row.created_at)
			})),
			billing: await buildBilling(userId)
		},
		context: CONTEXT
	};
}

function buildNoAccountExport(email) {
	console.error("No Clerk account found. Checking for a deletion record…");
	const hash = emailIdentityHash(email);
	const tombstones = d1Rows(
		`SELECT deleted_at FROM account_tombstones WHERE email_hash = '${hash}' ORDER BY deleted_at DESC`
	);
	const newest = tombstones[0] ?? null;
	return {
		generated_at: new Date().toISOString(),
		requested_for: email,
		identity: null,
		database: null,
		deletion_record:
			newest === null
				? null
				: {
						what: DELETION_RECORD_COPY,
						deleted_at: formatTimestamp(newest.deleted_at),
						purged_by: tombstonePurgeDate(newest.deleted_at)
					},
		note: newest === null ? NO_DATA_COPY : undefined,
		context: CONTEXT
	};
}

async function main() {
	const email = parseArgs(process.argv.slice(2));
	const clerkKey = requireClerkKey();

	console.error("Looking up the account in Clerk…");
	const clerkUser = await findClerkUser(email, clerkKey);
	const record =
		clerkUser === null
			? buildNoAccountExport(email)
			: await buildAccountExport(email, clerkUser);

	// Full date+time stamp (colons stripped) so re-runs get distinct names, and
	// exclusive create with owner-only permissions: the export holds personal
	// data and must never silently overwrite an earlier one.
	const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "");
	const name = `dsar-${clerkUser?.id ?? "no-account"}-${stamp}.json`;
	const outPath = join(process.env.INIT_CWD ?? process.cwd(), name);
	try {
		writeFileSync(outPath, `${JSON.stringify(record, null, "\t")}\n`, {
			mode: 0o600,
			flag: "wx"
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			console.error(
				`Refusing to overwrite ${outPath}. Move or delete it, then run again.`
			);
			process.exit(1);
		}
		throw error;
	}

	console.error(
		"This file holds personal data. Send it to the requester, then delete your copy."
	);
	console.log(outPath);
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	await main();
}
