import { links } from "@uwu/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./worker";

type LinkRow = typeof links.$inferSelect;

export async function reconcileLink(env: Pick<Env, "DB" | "UWU" | "CLICKS">, row: LinkRow): Promise<void> {
	const db = drizzle(env.DB);
	let claimed = false;
	try {
		if (row.lifecycleState === "pending_publish") {
			const result = await db.update(links)
				.set({ lifecycleState: "active", lastReconcileAt: new Date(), lastReconcileError: null })
				.where(and(eq(links.slug, row.slug), eq(links.lifecycleState, "pending_publish"))).run();
			if (result.meta.changes === 0) return;
			claimed = true;
			await env.UWU.put(row.slug, row.url);
			if (row.urlHash !== null) await env.UWU.put(`urlmap:${row.urlHash}`, row.slug);
			// Deletion can also win after the conditional update, while KV writes await.
			const current = await db.select().from(links).where(eq(links.slug, row.slug)).get();
			if (current === undefined || current.lifecycleState === "pending_delete") {
				await removeLinkKv(env, row);
			}
			return;
		}
		if (row.lifecycleState === "pending_delete") {
			const result = await db.delete(links)
				.where(and(eq(links.slug, row.slug), eq(links.lifecycleState, "pending_delete"))).run();
			if (result.meta.changes === 0) return;
			claimed = true;
			await removeLinkKv(env, row);
		}
	} catch (error) {
		// Preserve retry state on KV failure without overwriting a concurrent deletion
		// or a replacement row.
		if (claimed && row.lifecycleState === "pending_publish") {
			await db.update(links).set({ lifecycleState: "pending_publish" })
				.where(and(eq(links.slug, row.slug), eq(links.lifecycleState, "active"))).run();
		} else if (claimed && row.lifecycleState === "pending_delete") {
			await db.insert(links).values(row).onConflictDoNothing().run();
		}
		await db.update(links).set({ reconcileAttempts: row.reconcileAttempts + 1, lastReconcileAt: new Date(), lastReconcileError: error instanceof Error ? error.message.slice(0, 500) : "Unknown reconciliation error" }).where(eq(links.slug, row.slug)).run();
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

export async function reconcilePendingLinks(env: Pick<Env, "DB" | "UWU" | "CLICKS">): Promise<void> {
	// Listing the pending states rather than negating "active" keeps the scan on
	// links_lifecycle_idx; SQLite cannot use an index for an inequality here.
	const rows = await drizzle(env.DB).select().from(links).where(inArray(links.lifecycleState, ["pending_publish", "pending_delete"])).limit(100).all();
	const results = await Promise.allSettled(rows.map((row) => reconcileLink(env, row)));
	const failures = results.filter((result) => result.status === "rejected");
	if (failures.length > 0) console.error(JSON.stringify({ event: "link_reconciliation_failed", failures: failures.length, attempted: rows.length }));
}
