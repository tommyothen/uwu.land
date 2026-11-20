import { links } from "@uwu/db/schema";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { isBannedHostname, isBannedPath } from "./banned";
import type { Env } from "./worker";

type LinkRow = typeof links.$inferSelect;
type LinkStorage = Pick<Env, "DB" | "UWU" | "CLICKS" | "CLICK_COUNTER">;

export async function reconcileLink(env: Pick<Env, "ENFORCEMENT">, row: Pick<LinkRow, "slug">): Promise<void> {
	await env.ENFORCEMENT.getByName(`link:${row.slug}`).reconcileLink(row.slug);
}

/** Called only inside the slug's Durable Object queue. Read fresh state after queuing. */
export async function reconcileLinkState(env: LinkStorage, slug: string): Promise<void> {
	const db = drizzle(env.DB);
	const row = await db.select().from(links).where(eq(links.slug, slug)).get();
	if (row === undefined || row.lifecycleState === "active") return;
	try {
		if (row.lifecycleState === "pending_publish") {
			// createLink checks bans before its insert, so a ban written and swept
			// in between would miss this row. Every publication passes through
			// here, so checking again closes that gap. A banned row joins the
			// deletion below instead of being published.
			if (await isBannedDestination(env.UWU, row.url)) {
				await db.update(links).set({ lifecycleState: "pending_delete" })
					.where(and(eq(links.slug, slug), eq(links.lifecycleState, "pending_publish"))).run();
			} else {
				await env.UWU.put(row.slug, row.url);
				if (row.urlHash !== null) await env.UWU.put(`urlmap:${row.urlHash}`, row.slug);
				const result = await db.update(links)
					.set({ lifecycleState: "active", lastReconcileAt: new Date(), lastReconcileError: null })
					.where(and(eq(links.slug, slug), eq(links.lifecycleState, "pending_publish"))).run();
				if (result.meta.changes !== 0) return;
				// A delete may mark the row while publication awaits KV. Finish that
				// deletion before releasing the queue or freeing the slug for reuse.
			}
		}
		await removeLinkKv(env, row);
		await db.delete(links)
			.where(and(eq(links.slug, slug), eq(links.lifecycleState, "pending_delete"))).run();
	} catch (error) {
		// Pending state survives both exceptions and termination of the invocation.
		await db.update(links).set({
			reconcileAttempts: sql`${links.reconcileAttempts} + 1`,
			lastReconcileAt: new Date(),
			lastReconcileError: error instanceof Error ? error.message.slice(0, 500) : "Unknown reconciliation error"
		}).where(eq(links.slug, slug)).run();
		throw error;
	}
}

async function isBannedDestination(kv: KVNamespace, url: string): Promise<boolean> {
	if (!URL.canParse(url)) return false;
	const destination = new URL(url);
	return isBannedPath(destination.pathname) || (await isBannedHostname(kv, destination.hostname));
}

async function removeLinkKv(env: Pick<Env, "UWU" | "CLICKS" | "CLICK_COUNTER">, row: LinkRow): Promise<void> {
	await env.UWU.delete(row.slug);
	// Clear both the legacy and current counters so a reused slug starts at zero.
	await env.CLICKS.delete(row.slug);
	await env.CLICK_COUNTER.getByName(row.slug).reset();
	if (row.urlHash !== null) {
		const key = `urlmap:${row.urlHash}`;
		if ((await env.UWU.get(key)) === row.slug) await env.UWU.delete(key);
	}
}

// From a row's 12th failed attempt onwards, every failure also logs a distinct
// link_reconciliation_stuck warning. At the 5-minute
// cron that is roughly an hour of failures for a row retried every run.
export const STUCK_RECONCILE_ATTEMPTS = 12;

export async function reconcilePendingLinks(env: Pick<Env, "DB" | "ENFORCEMENT">): Promise<void> {
	// Listing the pending states rather than negating "active" keeps the scan on
	// links_lifecycle_idx; SQLite cannot use an index for an inequality here.
	// Fewest attempts first, then least recently tried (never-tried NULLs sort
	// first), so rows that keep failing back off behind healthy ones instead of
	// filling the batch on every run.
	const rows = await drizzle(env.DB).select().from(links)
		.where(inArray(links.lifecycleState, ["pending_publish", "pending_delete"]))
		.orderBy(asc(links.reconcileAttempts), asc(links.lastReconcileAt))
		.limit(100).all();
	const results = await Promise.allSettled(rows.map((row) => reconcileLink(env, row)));
	const failed = rows.filter((_row, index) => results[index]?.status === "rejected");
	if (failed.length === 0) return;
	console.error(JSON.stringify({ event: "link_reconciliation_failed", failures: failed.length, attempted: rows.length }));
	// reconcileAttempts was read before this run's failure incremented it.
	const stuck = failed.filter((row) => row.reconcileAttempts + 1 >= STUCK_RECONCILE_ATTEMPTS);
	if (stuck.length > 0) {
		console.warn(JSON.stringify({ event: "link_reconciliation_stuck", count: stuck.length, slugs: stuck.slice(0, 20).map((row) => row.slug) }));
	}
}

// D1 caps a statement at 100 bound parameters; two go on the lifecycle states.
const PARAMETER_BATCH = 90;
const LIVE_STATES = ["active", "pending_publish"] as const;

/**
 * Hands every live link whose host is one of `domains`, or a subdomain of one,
 * to the reconciler by marking it `pending_delete`. Used when a domain is
 * banned, so links created before the ban stop redirecting on the next cron
 * pass. instr() only narrows the scan; the parsed hostname decides. Not LIKE:
 * D1 refuses LIKE patterns over 50 bytes, and feed hosts run longer. Returns
 * how many rows were marked.
 */
export async function markDomainLinksForDeletion(db: D1Database, domains: readonly string[]): Promise<number> {
	const orm = drizzle(db);
	// Keyed by slug, since a row can match domains from two batches.
	const matches = new Map<string, string>();
	for (const batch of chunks(domains, PARAMETER_BATCH)) {
		const rows = await orm.select({ slug: links.slug, url: links.url }).from(links)
			.where(and(
				inArray(links.lifecycleState, LIVE_STATES),
				or(...batch.map((domain) => sql`instr(lower(${links.url}), ${domain}) > 0`))
			)).all();
		for (const row of rows) {
			if (batch.some((domain) => urlIsUnderDomain(row.url, domain))) matches.set(row.slug, row.url);
		}
	}
	// Each update matches the URL that was selected as well as the slug: a slug
	// freed and reused between the two phases now points somewhere else, and
	// must not be marked. Two parameters per pair.
	let marked = 0;
	for (const batch of chunks([...matches], PARAMETER_BATCH / 2)) {
		const result = await orm.update(links).set({ lifecycleState: "pending_delete" })
			.where(and(
				inArray(links.lifecycleState, LIVE_STATES),
				or(...batch.map(([slug, url]) => and(eq(links.slug, slug), eq(links.url, url))))
			)).run();
		marked += result.meta.changes;
	}
	return marked;
}

function urlIsUnderDomain(url: string, domain: string): boolean {
	if (!URL.canParse(url)) return false;
	const hostname = new URL(url).hostname;
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}
