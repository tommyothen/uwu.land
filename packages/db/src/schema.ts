import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	tier: text("tier", { enum: ["free", "pro"] }).notNull().default("free"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date())
});

export const apiKeys = sqliteTable("api_keys", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id),
	name: text("name").notNull(),
	keyHash: text("key_hash").notNull().unique(),
	displayPrefix: text("display_prefix").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
	revokedAt: integer("revoked_at", { mode: "timestamp" })
});

export const links = sqliteTable(
	"links",
	{
		slug: text("slug").primaryKey(),
		url: text("url").notNull(),
		ownerId: text("owner_id").references(() => users.id),
		externalRef: text("external_ref"),
		source: text("source", {
			enum: ["web-anon", "api", "dashboard"]
		}).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index("links_owner_idx").on(t.ownerId, t.externalRef),
		index("links_owner_created_slug_idx").on(
			t.ownerId,
			t.createdAt,
			t.slug
		),
		index("links_owner_external_ref_created_slug_idx").on(
			t.ownerId,
			t.externalRef,
			t.createdAt,
			t.slug
		)
	]
);
