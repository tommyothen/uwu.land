import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	apiKeys,
	clerkSubscriptionItems,
	clerkWebhookEvents,
	links,
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

		expect(indexes.map(({ name }) => name)).toEqual(
			expect.arrayContaining([
				"api_keys_key_hash_unique",
				"links_owner_idx"
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

	it("stores Clerk webhook and per-item subscription state", () => {
		const db = createDb();
		db.insert(users).values({ id: "user_123" }).run();
		db.insert(clerkWebhookEvents)
			.values({ id: "msg_123", eventTimestamp: 1_700_000_000_000 })
			.run();
		db.insert(clerkSubscriptionItems)
			.values({
				id: "subi_123",
				payerUserId: "user_123",
				planSlug: "first_class",
				status: "active",
				eventTimestamp: 1_700_000_000_000,
				eventId: "msg_123"
			})
			.run();

		expect(db.select().from(clerkSubscriptionItems).all()).toMatchObject([
			{
				id: "subi_123",
				payerUserId: "user_123",
				status: "active",
				eventId: "msg_123"
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
