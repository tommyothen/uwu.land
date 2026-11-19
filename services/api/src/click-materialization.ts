import { parseLegacyClicks } from "./click-counter";
import type { Env } from "./worker";

const LEGACY_DRAIN_BATCH_SIZE = 50;

/**
 * One-off migration off the old CLICKS KV counters, run by the five-minute
 * cron. Each run copies one page into `links.clicks` (never lowering it, since
 * ClickCounter may already have flushed a higher total) and then deletes those
 * keys, so the namespace empties itself and later runs are a single empty list.
 * D1 is updated before the keys go; ClickCounter's seed relies on that order.
 * Once CLICKS is empty, this, the binding and the seed's KV read can go.
 */
export async function drainLegacyClickCounters(
	env: Pick<Env, "CLICKS" | "DB">
): Promise<void> {
	const page = await env.CLICKS.list({ limit: LEGACY_DRAIN_BATCH_SIZE });
	if (page.keys.length === 0) return;
	const values = await Promise.all(
		page.keys.map(async ({ name }) => ({
			slug: name,
			clicks: parseLegacyClicks(await env.CLICKS.get(name))
		}))
	);
	await env.DB.batch(
		values.map(({ slug, clicks }) =>
			env.DB.prepare("UPDATE links SET clicks = MAX(clicks, ?) WHERE slug = ?").bind(clicks, slug)
		)
	);
	await Promise.all(page.keys.map(({ name }) => env.CLICKS.delete(name)));
}
