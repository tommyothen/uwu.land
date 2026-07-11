import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
		lifecycleState: text("lifecycle_state", {
			enum: ["pending_publish", "active", "pending_delete"]
		}).notNull().default("active"),
		urlHash: text("url_hash"),
		reconcileAttempts: integer("reconcile_attempts").notNull().default(0),
		lastReconcileAt: integer("last_reconcile_at", { mode: "timestamp" }),
		lastReconcileError: text("last_reconcile_error"),
		clicks: integer("clicks").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [index("links_owner_idx").on(t.ownerId, t.externalRef), index("links_lifecycle_idx").on(t.lifecycleState, t.createdAt), uniqueIndex("links_url_hash_unique").on(t.urlHash)]
);

export const clickMaterializationState = sqliteTable("click_materialization_state", {
	id: integer("id").primaryKey(),
	cursor: text("cursor"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});
