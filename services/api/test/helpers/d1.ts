import { applyD1Migrations, env } from "cloudflare:test";

type MigrationEnv = typeof env & {
	TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

export async function resetD1(db: D1Database): Promise<void> {
	await applyD1Migrations(
		db,
		(env as MigrationEnv).TEST_MIGRATIONS
	);
	await db.batch([
		db.prepare("DELETE FROM api_keys"),
		db.prepare("DELETE FROM links"),
		db.prepare("DELETE FROM stripe_subscriptions"),
		db.prepare("DELETE FROM stripe_customers"),
		db.prepare("DELETE FROM stripe_webhook_events"),
		db.prepare("DELETE FROM account_tombstones"),
		db.prepare("DELETE FROM click_materialization_state"),
		db.prepare("DELETE FROM users")
	]);
}
