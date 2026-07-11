import { DurableObject } from "cloudflare:workers";

import type { FixedWindowUsage, RateLimitResult } from "./rate-limit";

export interface AbusePolicy {
	threshold: number;
	windowSeconds: number;
	blockSeconds: number;
}

export class Enforcement extends DurableObject<Cloudflare.Env> {
	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS fixed_window (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				count INTEGER NOT NULL,
				reset_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS abuse (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				count INTEGER NOT NULL,
				reset_at INTEGER NOT NULL,
				blocked_until INTEGER
			);
		`);
	}

	async limitFixedWindow(
		maxRequests: number,
		windowSeconds: number,
		now = Date.now()
	): Promise<RateLimitResult> {
		const current = this.fixedWindow(now);
		if (current !== null && current.count >= maxRequests) {
			return {
				allowed: false,
				retryAfterSeconds: Math.max(
					1,
					Math.ceil((current.resetAt - now) / 1000)
				)
			};
		}

		const next =
			current === null
				? { count: 1, resetAt: now + windowSeconds * 1000 }
				: { count: current.count + 1, resetAt: current.resetAt };
		this.ctx.storage.sql.exec(
			`INSERT INTO fixed_window (id, count, reset_at) VALUES (1, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at`,
			next.count,
			next.resetAt
		);
		return { allowed: true };
	}

	async fixedWindowUsage(now = Date.now()): Promise<FixedWindowUsage | null> {
		return this.fixedWindow(now);
	}

	async recordBannedAttempt(
		policy: AbusePolicy,
		now = Date.now()
	): Promise<void> {
		const row = this.ctx.storage.sql
			.exec<{ count: number; reset_at: number; blocked_until: number | null }>(
				"SELECT count, reset_at, blocked_until FROM abuse WHERE id = 1"
			)
			.toArray()[0];
		const count = row === undefined || row.reset_at <= now ? 1 : row.count + 1;
		const resetAt =
			row === undefined || row.reset_at <= now
				? now + policy.windowSeconds * 1000
				: row.reset_at;
		const blockedUntil =
			count >= policy.threshold
				? now + policy.blockSeconds * 1000
				: row?.blocked_until ?? null;

		this.ctx.storage.sql.exec(
			`INSERT INTO abuse (id, count, reset_at, blocked_until) VALUES (1, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET
				count = excluded.count,
				reset_at = excluded.reset_at,
				blocked_until = excluded.blocked_until`,
			count,
			resetAt,
			blockedUntil
		);
	}

	async isBlocked(now = Date.now()): Promise<boolean> {
		const row = this.ctx.storage.sql
			.exec<{ blocked_until: number | null }>(
				"SELECT blocked_until FROM abuse WHERE id = 1"
			)
			.toArray()[0];
		return row?.blocked_until !== null && row?.blocked_until !== undefined
			? row.blocked_until > now
			: false;
	}

	private fixedWindow(now: number): FixedWindowUsage | null {
		const row = this.ctx.storage.sql
			.exec<{ count: number; reset_at: number }>(
				"SELECT count, reset_at FROM fixed_window WHERE id = 1"
			)
			.toArray()[0];
		return row === undefined || row.reset_at <= now
			? null
			: { count: row.count, resetAt: row.reset_at };
	}
}
