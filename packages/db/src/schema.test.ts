import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	accountTombstones,
	apiKeys,
	links,
	stripeSubscriptions,
	stripeWebhookEvents,
	users
} from "./schema";

function createSqlite() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	const migrationsDirectory = new URL("../migrations/", import.meta.url);
	for (const migration of readdirSync(migrationsDirectory)
		.filter((file) => file.endsWith(".sql"))
		.sort()) {
		const sql = readFileSync(new URL(migration, migrationsDirectory), "utf8");
		sqlite.exec(sql.replaceAll("--> statement-breakpoint", ""));
	}
	return sqlite;
}

function createDb() {
	return drizzle(createSqlite());
}

function seedOwnedLinks(sqlite: Database.Database) {
	const insertUser = sqlite.prepare(
		"INSERT INTO users (id, tier, created_at) VALUES (?, 'free', ?)"
	);
	const insertLink = sqlite.prepare(
		"INSERT INTO links (slug, url, owner_id, external_ref, source, created_at) VALUES (?, ?, ?, ?, 'api', ?)"
	);
	sqlite.transaction(() => {
		for (let owner = 0; owner < 4; owner += 1) {
			const ownerId = `owner_${owner}`;
			insertUser.run(ownerId, 1_700_000_000 + owner);
			for (let link = 0; link < 250; link += 1) {
				insertLink.run(
					`slug_${owner}_${link.toString().padStart(4, "0")}`,
					`https://example.com/${owner}/${link}`,
					ownerId,
					`ref_${link % 5}`,
					1_700_000_000 + Math.floor(link / 3)
				);
			}
		}
	})();
	sqlite.exec("ANALYZE");
}

function expectIndexPlan(
	sqlite: Database.Database,
	query: string,
	params: unknown[],
	indexName: string
) {
	const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params) as Array<{
		detail: string;
	}>;
	const details = plan.map(({ detail }) => detail);

	expect(details).toEqual(
		expect.arrayContaining([
			expect.stringContaining(`SEARCH links USING INDEX ${indexName}`)
		])
	);
	expect(details.join("\n")).not.toContain("USE TEMP B-TREE");
}

describe("schema", () => {
	it("applies canonical indexes and foreign keys", () => {
		const sqlite = createSqlite();
		const indexes = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
			.all() as Array<{ name: string }>;
		const apiKeyForeignKeys = sqlite.pragma("foreign_key_list('api_keys')") as Array<{
			from: string;
			table: string;
		}>;
		const linkForeignKeys = sqlite.pragma("foreign_key_list('links')") as Array<{
			from: string;
			table: string;
		}>;
		const stripeForeignKeys = sqlite.pragma(
			"foreign_key_list('stripe_subscriptions')"
		) as Array<{
			from: string;
			table: string;
		}>;

		expect(indexes.map(({ name }) => name)).toEqual(
			expect.arrayContaining([
				"account_tombstones_email_idx",
				"api_keys_key_hash_unique",
				"stripe_subscriptions_user_idx",
				"links_owner_idx",
				"links_owner_created_slug_idx",
				"links_owner_external_ref_created_slug_idx"
			])
		);
		expect(apiKeyForeignKeys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "user_id", table: "users" })
			])
		);
		expect(linkForeignKeys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "owner_id", table: "users" })
			])
		);
		expect(stripeForeignKeys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: "event_id",
					table: "stripe_webhook_events"
				})
			])
		);
	});

	it("uses ordered owner indexes for list pagination plans", () => {
		const sqlite = createSqlite();
		seedOwnedLinks(sqlite);
		const cursorCreatedAt = 1_700_000_060;
		const cursorSlug = "slug_1_0180";

		expectIndexPlan(
			sqlite,
			"SELECT * FROM links WHERE owner_id = ? ORDER BY created_at DESC, slug DESC LIMIT 26",
			["owner_1"],
			"links_owner_created_slug_idx"
		);
		expectIndexPlan(
			sqlite,
			"SELECT * FROM links WHERE owner_id = ? AND (created_at < ? OR (created_at = ? AND slug < ?)) ORDER BY created_at DESC, slug DESC LIMIT 26",
			["owner_1", cursorCreatedAt, cursorCreatedAt, cursorSlug],
			"links_owner_created_slug_idx"
		);
		expectIndexPlan(
			sqlite,
			"SELECT * FROM links WHERE owner_id = ? AND external_ref = ? ORDER BY created_at DESC, slug DESC LIMIT 26",
			["owner_1", "ref_1"],
			"links_owner_external_ref_created_slug_idx"
		);
		expectIndexPlan(
			sqlite,
			"SELECT * FROM links WHERE owner_id = ? AND external_ref = ? AND (created_at < ? OR (created_at = ? AND slug < ?)) ORDER BY created_at DESC, slug DESC LIMIT 26",
			["owner_1", "ref_1", cursorCreatedAt, cursorCreatedAt, cursorSlug],
			"links_owner_external_ref_created_slug_idx"
		);
	});

	it("inserts and reads users with the free tier default", () => {
		const db = createDb();

		db.insert(users).values({ id: "user_123" }).run();

		expect(db.select().from(users).all()).toMatchObject([
			{
				id: "user_123",
				tier: "free"
			}
		]);
	});

	it("stores user identity limits and account tombstones", () => {
		const db = createDb();
		const limitedUntil = new Date("2026-07-19T12:00:00.000Z");
		const deletedAt = new Date("2026-07-12T12:00:00.000Z");
		db.insert(users)
			.values({
				id: "user_identity",
				emailHash: "email_hash",
				limitedUntil
			})
			.run();
		db.insert(accountTombstones)
			.values({ eventId: "msg_deleted", emailHash: "email_hash", deletedAt })
			.run();

		expect(db.select().from(users).all()).toMatchObject([
			{ id: "user_identity", emailHash: "email_hash", limitedUntil }
		]);
		expect(db.select().from(accountTombstones).all()).toEqual([
			{ eventId: "msg_deleted", emailHash: "email_hash", deletedAt }
		]);
	});

	it("stores Stripe webhook and subscription state", () => {
		const db = createDb();
		db.insert(users).values({ id: "user_123" }).run();
		db.insert(stripeWebhookEvents)
			.values({ id: "evt_123", eventTimestamp: 1_700_000_000 })
			.run();
		db.insert(stripeSubscriptions)
			.values({
				id: "sub_123",
				customerId: "cus_123",
				userId: "user_123",
				status: "active",
				eventTimestamp: 1_700_000_000,
				eventId: "evt_123"
			})
			.run();

		expect(db.select().from(stripeSubscriptions).all()).toMatchObject([
			{
				id: "sub_123",
				customerId: "cus_123",
				userId: "user_123",
				status: "active",
				eventId: "evt_123"
			}
		]);
	});

	it("stores api keys with unique hashes and a user foreign key", () => {
		const db = createDb();
		db.insert(users).values({ id: "user_123" }).run();

		db.insert(apiKeys)
			.values({
				id: "key_123",
				userId: "user_123",
				name: "Hayasaka",
				keyHash: "a".repeat(64),
				displayPrefix: "uwu_a1B2c3D4"
			})
			.run();

		expect(db.select().from(apiKeys).all()).toMatchObject([
			{
				id: "key_123",
				userId: "user_123",
				name: "Hayasaka",
				keyHash: "a".repeat(64),
				displayPrefix: "uwu_a1B2c3D4"
			}
		]);
		expect(() =>
			db.insert(apiKeys)
				.values({
					id: "key_456",
					userId: "user_123",
					name: "Duplicate",
					keyHash: "a".repeat(64),
					displayPrefix: "uwu_duplicate"
				})
				.run()
		).toThrow();
		expect(() =>
			db.insert(apiKeys)
				.values({
					id: "key_orphan",
					userId: "user_missing",
					name: "Orphan",
					keyHash: "b".repeat(64),
					displayPrefix: "uwu_orphan"
				})
				.run()
		).toThrow();
	});

	it("stores anonymous and owned links and enforces slug uniqueness", () => {
		const db = createDb();
		db.insert(users).values({ id: "user_123" }).run();

		db.insert(links)
			.values({
				slug: "anon1",
				url: "https://example.com/anon",
				ownerId: null,
				source: "web-anon"
			})
			.run();
		db.insert(links)
			.values({
				slug: "owned1",
				url: "https://example.com/owned",
				ownerId: "user_123",
				externalRef: "discord:42",
				source: "api"
			})
			.run();

		expect(db.select().from(links).orderBy(links.slug).all()).toMatchObject([
			{
				slug: "anon1",
				url: "https://example.com/anon",
				ownerId: null,
				externalRef: null,
				source: "web-anon"
			},
			{
				slug: "owned1",
				url: "https://example.com/owned",
				ownerId: "user_123",
				externalRef: "discord:42",
				source: "api"
			}
		]);
		expect(db.select().from(links).where(eq(links.ownerId, "user_123")).all()).toHaveLength(1);
		expect(() =>
			db.insert(links)
				.values({
					slug: "owned1",
					url: "https://example.com/duplicate",
					ownerId: "user_123",
					source: "dashboard"
				})
				.run()
		).toThrow();
	});
});
