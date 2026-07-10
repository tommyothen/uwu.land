import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { apiKeys, links, users } from "./schema";

function createDb() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	sqlite.exec(`
		CREATE TABLE users (
			id text PRIMARY KEY NOT NULL,
			tier text DEFAULT 'free' NOT NULL,
			created_at integer NOT NULL
		);
		CREATE TABLE api_keys (
			id text PRIMARY KEY NOT NULL,
			user_id text NOT NULL,
			name text NOT NULL,
			key_hash text NOT NULL,
			display_prefix text NOT NULL,
			created_at integer NOT NULL,
			last_used_at integer,
			revoked_at integer,
			FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE no action
		);
		CREATE UNIQUE INDEX api_keys_key_hash_unique ON api_keys (key_hash);
		CREATE TABLE links (
			slug text PRIMARY KEY NOT NULL,
			url text NOT NULL,
			owner_id text,
			external_ref text,
			source text NOT NULL,
			created_at integer NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE no action ON DELETE no action
		);
		CREATE INDEX links_owner_idx ON links (owner_id, external_ref);
	`);

	return drizzle(sqlite);
}

describe("schema", () => {
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
