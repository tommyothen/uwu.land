import { DurableObject } from "cloudflare:workers";

import type { FixedWindowUsage, RateLimitResult } from "./rate-limit";

export interface AbusePolicy {
	threshold: number;
	windowSeconds: number;
	blockSeconds: number;
}

export class Enforcement extends DurableObject<Cloudflare.Env> {
	private schemaReady = false;

	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		this.ensureSchema();
	}

	private ensureSchema(): void {
		if (this.schemaReady) {
			return;
		}
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
		this.schemaReady = true;
	}

	async limitFixedWindow(
		maxRequests: number,
		windowSeconds: number,
		now = Date.now()
	): Promise<RateLimitResult> {
		this.ensureSchema();
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
		await this.scheduleCleanup(now);
		return { allowed: true };
	}

	async fixedWindowUsage(now = Date.now()): Promise<FixedWindowUsage | null> {
		this.ensureSchema();
		return this.fixedWindow(now);
	}

	async recordBannedAttempt(
		policy: AbusePolicy,
		now = Date.now()
	): Promise<void> {
		this.ensureSchema();
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
		await this.scheduleCleanup(now);
	}

	async isBlocked(now = Date.now()): Promise<boolean> {
		this.ensureSchema();
		const row = this.ctx.storage.sql
			.exec<{ blocked_until: number | null }>(
				"SELECT blocked_until FROM abuse WHERE id = 1"
			)
			.toArray()[0];
		return row?.blocked_until !== null && row?.blocked_until !== undefined
			? row.blocked_until > now
			: false;
	}

	async clearStoredState(): Promise<void> {
		await this.ctx.storage.deleteAll();
		this.schemaReady = false;
	}

	async alarm(): Promise<void> {
		this.ensureSchema();
		await this.scheduleCleanup(Date.now());
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

	private latestActiveExpiry(now: number): number | null {
		const fixedWindow = this.ctx.storage.sql
			.exec<{ reset_at: number }>(
				"SELECT reset_at FROM fixed_window WHERE id = 1"
			)
			.toArray()[0];
		const abuse = this.ctx.storage.sql
			.exec<{ reset_at: number; blocked_until: number | null }>(
				"SELECT reset_at, blocked_until FROM abuse WHERE id = 1"
			)
			.toArray()[0];
		const expiries = [
			fixedWindow?.reset_at,
			abuse?.reset_at,
			abuse?.blocked_until ?? undefined
		].filter((expiry): expiry is number => expiry !== undefined && expiry > now);
		return expiries.length === 0 ? null : Math.max(...expiries);
	}

	private async scheduleCleanup(now: number): Promise<void> {
		const expiry = this.latestActiveExpiry(now);
		if (expiry === null) {
			await this.ctx.storage.deleteAll();
			this.schemaReady = false;
			return;
		}
		// Alarms fire on the wall clock, so only schedule one when the expiry is
		// genuinely in the wall-clock future. Callers pass Date.now() in
		// production (always future), but tests may pass a logical `now`; without
		// this guard that would schedule an immediately-overdue alarm whose
		// handler runs against the real clock and wipes still-active state.
		if (expiry > Date.now()) {
			await this.ctx.storage.setAlarm(expiry);
		}
	}
}
