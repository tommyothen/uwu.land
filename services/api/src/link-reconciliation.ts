import { links } from "@uwu/db/schema";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./worker";

type LinkRow = typeof links.$inferSelect;
type LinkStorage = Pick<Env, "DB" | "UWU" | "CLICKS">;

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
			await env.UWU.put(row.slug, row.url);
			if (row.urlHash !== null) await env.UWU.put(`urlmap:${row.urlHash}`, row.slug);
			const result = await db.update(links)
				.set({ lifecycleState: "active", lastReconcileAt: new Date(), lastReconcileError: null })
				.where(and(eq(links.slug, slug), eq(links.lifecycleState, "pending_publish"))).run();
			if (result.meta.changes !== 0) return;
			// A delete may mark the row while publication awaits KV. Finish that
			// deletion before releasing the queue or freeing the slug for reuse.
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

async function removeLinkKv(env: Pick<Env, "UWU" | "CLICKS">, row: LinkRow): Promise<void> {
	await env.UWU.delete(row.slug);
	await env.CLICKS.delete(row.slug);
	if (row.urlHash !== null) {
		const key = `urlmap:${row.urlHash}`;
		if ((await env.UWU.get(key)) === row.slug) await env.UWU.delete(key);
	}
}

export async function reconcilePendingLinks(env: Pick<Env, "DB" | "ENFORCEMENT">): Promise<void> {
	// Listing the pending states rather than negating "active" keeps the scan on
	// links_lifecycle_idx; SQLite cannot use an index for an inequality here.
	const rows = await drizzle(env.DB).select().from(links).where(inArray(links.lifecycleState, ["pending_publish", "pending_delete"])).limit(100).all();
	const results = await Promise.allSettled(rows.map((row) => reconcileLink(env, row)));
	const failures = results.filter((result) => result.status === "rejected");
	if (failures.length > 0) console.error(JSON.stringify({ event: "link_reconciliation_failed", failures: failures.length, attempted: rows.length }));
}

// D1 caps a statement at 100 bound parameters; two go on the lifecycle states.
const PARAMETER_BATCH = 90;
const LIVE_STATES = ["active", "pending_publish"] as const;

/**
 * Hands every live link whose host is one of `domains`, or a subdomain of one,
 * to the reconciler by marking it `pending_delete`. Used when a domain is
 * banned, so links created before the ban stop redirecting on the next cron
 * pass. The LIKE only narrows the scan; the parsed hostname decides.
 */
export async function markDomainLinksForDeletion(db: D1Database, domains: readonly string[]): Promise<number> {
	const orm = drizzle(db);
	// A Set, since a row can match domains from two batches.
	const slugs = new Set<string>();
	for (const batch of chunks(domains, PARAMETER_BATCH)) {
		const rows = await orm.select({ slug: links.slug, url: links.url }).from(links)
			.where(and(
				inArray(links.lifecycleState, LIVE_STATES),
				or(...batch.map((domain) => like(sql`lower(${links.url})`, `%${domain}%`)))
			)).all();
		for (const row of rows) {
			if (batch.some((domain) => urlIsUnderDomain(row.url, domain))) slugs.add(row.slug);
		}
	}
	for (const batch of chunks([...slugs], PARAMETER_BATCH)) {
		await orm.update(links).set({ lifecycleState: "pending_delete" })
			.where(and(inArray(links.slug, batch), inArray(links.lifecycleState, LIVE_STATES))).run();
	}
	return slugs.size;
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
