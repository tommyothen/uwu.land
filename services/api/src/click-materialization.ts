import type { Env } from "./worker";

const CLICK_SNAPSHOT_BATCH_SIZE = 50;
const STATE_ID = 1;

interface MaterializationState {
	cursor: string | null;
}

function numericClicks(value: string | null): number {
	const clicks = Number.parseInt(value ?? "0", 10);
	return Number.isFinite(clicks) && clicks >= 0 ? clicks : 0;
}

/**
 * Copies one bounded page of the KV counters into D1. Values are absolute, so
 * retrying a page is idempotent. The cursor advances in the same D1 batch as
 * the snapshots; a failed batch is retried from its previous position.
 */
export async function materializeClickCounts(
	env: Pick<Env, "CLICKS" | "DB">
): Promise<void> {
	const state = await env.DB.prepare(
		"SELECT cursor FROM click_materialization_state WHERE id = ?"
	)
		.bind(STATE_ID)
		.first<MaterializationState>();
	const page = await env.CLICKS.list({
		cursor: state?.cursor ?? undefined,
		limit: CLICK_SNAPSHOT_BATCH_SIZE
	});
	const values = await Promise.all(
		page.keys.map(async ({ name }) => ({
			slug: name,
			clicks: numericClicks(await env.CLICKS.get(name))
		}))
	);
	const nextCursor = page.list_complete ? null : page.cursor;
	const statements = values.map(({ slug, clicks }) =>
		env.DB.prepare("UPDATE links SET clicks = ? WHERE slug = ?").bind(
			clicks,
			slug
		)
	);
	statements.push(
		env.DB.prepare(
			"INSERT INTO click_materialization_state (id, cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at"
		).bind(STATE_ID, nextCursor, Date.now())
	);
	await env.DB.batch(statements);
}
