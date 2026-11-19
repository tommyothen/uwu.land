// Replay records only need to outlive provider redelivery. Signed payloads are
// rejected after 5 minutes (Stripe's SIGNATURE_TOLERANCE_SECONDS and Svix's
// default tolerance), so the tables just catch the provider resending an event
// it already delivered: Stripe retries for up to 3 days and Svix for about a
// day. 30 days leaves ample room for those and for manual dashboard resends.
export const WEBHOOK_EVENT_RETENTION_MS = 30 * 86_400 * 1000;

/**
 * Deletes processed webhook ids older than the retention window, run from the
 * daily cron. Stripe rows still named by a subscription or lifetime purchase
 * event_id are kept, since those columns are foreign keys onto this table.
 * deleted_users is a separate, permanent table and is never touched here.
 */
export async function purgeExpiredWebhookEvents(
	db: D1Database,
	now = Date.now()
): Promise<void> {
	const cutoff = now - WEBHOOK_EVENT_RETENTION_MS;
	await db.batch([
		db
			.prepare(
				`DELETE FROM stripe_webhook_events WHERE processed_at < ?
				 AND NOT EXISTS (SELECT 1 FROM stripe_subscriptions WHERE event_id = stripe_webhook_events.id)
				 AND NOT EXISTS (SELECT 1 FROM stripe_lifetime_purchases WHERE event_id = stripe_webhook_events.id)`
			)
			.bind(cutoff),
		db
			.prepare("DELETE FROM clerk_webhook_events WHERE processed_at < ?")
			.bind(cutoff)
	]);
}
