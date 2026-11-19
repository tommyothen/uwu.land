import { DurableObject } from "cloudflare:workers";

/** How long hits buffer in a counter before they are flushed to `links.clicks`. */
export const CLICK_FLUSH_DELAY_MS = 5 * 60 * 1000;
const CLICK_FLUSH_RETRY_MS = 60 * 1000;

/** Parses a legacy CLICKS KV value, treating anything malformed as zero. */
export function parseLegacyClicks(value: string | null): number {
	const clicks = Number.parseInt(value ?? "0", 10);
	return Number.isFinite(clicks) && clicks >= 0 ? clicks : 0;
}

/**
 * The total a counter starts from: the larger of `links.clicks` in D1 and the
 * legacy CLICKS KV value that has not been drained yet. Totals only ever grow,
 * so the larger one is always the truest. KV is read before D1 on purpose: the
 * legacy drain updates D1 before it deletes the KV key, so this order can
 * never see the key gone and D1 not yet updated.
 */
async function seedClicks(env: Cloudflare.Env, slug: string): Promise<number> {
	const legacy = parseLegacyClicks(await env.CLICKS.get(slug));
	const row = await env.DB.prepare("SELECT clicks FROM links WHERE slug = ?")
		.bind(slug)
		.first<{ clicks: number }>();
	return Math.max(row?.clicks ?? 0, legacy);
}

/**
 * One object per slug (`getByName(slug)`). It only exists while a link is
 * being clicked: each hit is one synchronous storage write, and an alarm
 * flushes the absolute total to `links.clicks` then deletes all state once no
 * new hits have arrived. D1 is therefore the durable total and this object is
 * a short-lived buffer on top of it, so storage never grows for dead links.
 *
 * Storage keys: `slug`, `hits` (clicks recorded since state was created) and
 * `base` (the seeded total, set on first flush).
 */
export class ClickCounter extends DurableObject<Cloudflare.Env> {
	// Avoids a getAlarm() round trip on every hit once a flush is scheduled.
	#flushScheduled = false;

	async increment(slug: string): Promise<void> {
		const kv = this.ctx.storage.kv;
		if (kv.get<string>("slug") === undefined) kv.put("slug", slug);
		kv.put("hits", (kv.get<number>("hits") ?? 0) + 1);
		if (this.#flushScheduled) return;
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + CLICK_FLUSH_DELAY_MS);
		}
		this.#flushScheduled = true;
	}

	/** The exact total, including hits not yet flushed to D1. Never writes. */
	async clicks(slug: string): Promise<number> {
		const base = this.ctx.storage.kv.get<number>("base") ?? (await seedClicks(this.env, slug));
		return base + (this.ctx.storage.kv.get<number>("hits") ?? 0);
	}

	/** Drops all state. Called when a link is deleted so a reused slug starts at zero. */
	async reset(): Promise<void> {
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		this.#flushScheduled = false;
	}

	async alarm(): Promise<void> {
		this.#flushScheduled = false;
		const kv = this.ctx.storage.kv;
		const slug = kv.get<string>("slug");
		if (slug === undefined) {
			await this.reset();
			return;
		}
		try {
			const base = kv.get<number>("base") ?? (await seedClicks(this.env, slug));
			kv.put("base", base);
			const hits = kv.get<number>("hits") ?? 0;
			// Absolute, so a retried flush cannot double count.
			const result = await this.env.DB.prepare("UPDATE links SET clicks = ? WHERE slug = ?")
				.bind(base + hits, slug)
				.run();
			// Hits can land while the write is in flight; keep them for the next flush.
			if (result.meta.changes === 0 || kv.get<number>("hits") === hits) {
				await this.reset();
				return;
			}
			await this.ctx.storage.setAlarm(Date.now() + CLICK_FLUSH_DELAY_MS);
		} catch (error) {
			// Reschedule ourselves rather than lean on the runtime's capped retries.
			console.error(JSON.stringify({
				event: "click_flush_failed",
				error: error instanceof Error ? error.message : String(error)
			}));
			await this.ctx.storage.setAlarm(Date.now() + CLICK_FLUSH_RETRY_MS);
		}
		this.#flushScheduled = true;
	}
}
