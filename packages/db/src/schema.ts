import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	tier: text("tier", { enum: ["free", "pro"] }).notNull().default("free"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	emailHash: text("email_hash"),
	limitedUntil: integer("limited_until", { mode: "timestamp" })
});

export const accountTombstones = sqliteTable(
	"account_tombstones",
	{
		eventId: text("event_id").primaryKey(),
		emailHash: text("email_hash").notNull(),
		deletedAt: integer("deleted_at", { mode: "timestamp" }).notNull()
	},
	(t) => [
		index("account_tombstones_email_idx").on(t.emailHash, t.deletedAt)
	]
);

// Permanent record of deleted Clerk user ids. Late webhook deliveries and
// still-valid session JWTs must never recreate a deleted account, and a
// surviving non-entitling Stripe subscription can emit events long after the
// 30-day tombstone window, so rows here are never purged. Stores opaque Clerk
// ids only, no email.
export const deletedUsers = sqliteTable("deleted_users", {
	userId: text("user_id").primaryKey(),
	deletedAt: integer("deleted_at", { mode: "timestamp" }).notNull()
});

export const clerkWebhookEvents = sqliteTable("clerk_webhook_events", {
	id: text("id").primaryKey(),
	eventTimestamp: integer("event_timestamp").notNull(),
	processedAt: integer("processed_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date())
});

export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
	id: text("id").primaryKey(),
	eventTimestamp: integer("event_timestamp").notNull(),
	processedAt: integer("processed_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date())
});

export const stripeCustomers = sqliteTable(
	"stripe_customers",
	{
		userId: text("user_id").primaryKey(),
		customerId: text("customer_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [uniqueIndex("stripe_customers_customer_unique").on(t.customerId)]
);

export const stripeSubscriptions = sqliteTable(
	"stripe_subscriptions",
	{
		id: text("id").primaryKey(),
		customerId: text("customer_id").notNull(),
		priceId: text("price_id").notNull(),
		userId: text("user_id").notNull(),
		status: text("status", {
			enum: [
				"active",
				"trialing",
				"past_due",
				"canceled",
				"unpaid",
				"incomplete",
				"incomplete_expired",
				"paused"
			]
		}).notNull(),
		eventTimestamp: integer("event_timestamp").notNull(),
		eventId: text("event_id")
			.notNull()
			.references(() => stripeWebhookEvents.id)
	},
	(t) => [index("stripe_subscriptions_user_idx").on(t.userId)]
);

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
	(t) => [
		index("links_owner_idx").on(t.ownerId, t.externalRef),
		index("links_lifecycle_idx").on(t.lifecycleState, t.createdAt),
		uniqueIndex("links_url_hash_unique").on(t.urlHash),
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

export const clickMaterializationState = sqliteTable("click_materialization_state", {
	id: integer("id").primaryKey(),
	cursor: text("cursor"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});
