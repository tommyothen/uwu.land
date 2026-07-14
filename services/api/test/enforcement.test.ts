import {
	env,
	runDurableObjectAlarm,
	runInDurableObject
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
	ABUSE_THRESHOLD,
	ABUSE_WINDOW_SECONDS,
	IP_BLOCK_SECONDS
} from "../src/abuse";

describe("atomic enforcement", () => {
	it("allows exactly the fixed-window maximum under concurrency", async () => {
		const stub = env.ENFORCEMENT.getByName("test:concurrent-limit");
		const results = await Promise.all(
			Array.from({ length: 20 }, () => stub.limitFixedWindow(7, 60, 1_000))
		);

		expect(results.filter((result) => result.allowed)).toHaveLength(7);
		expect(results.filter((result) => !result.allowed)).toHaveLength(13);
		expect(await stub.fixedWindowUsage(1_000)).toEqual({
			count: 7,
			resetAt: 61_000
		});
	});

	it("blocks exactly at the simultaneous abuse threshold", async () => {
		const stub = env.ENFORCEMENT.getByName("abuse:198.51.100.20");
		const policy = {
			threshold: ABUSE_THRESHOLD,
			windowSeconds: ABUSE_WINDOW_SECONDS,
			blockSeconds: IP_BLOCK_SECONDS
		};

		await Promise.all(
			Array.from({ length: ABUSE_THRESHOLD - 1 }, () =>
				stub.recordBannedAttempt(policy, 2_000)
			)
		);
		expect(await stub.isBlocked(2_000)).toBe(false);

		await stub.recordBannedAttempt(policy, 2_000);
		expect(await stub.isBlocked(2_000)).toBe(true);
		await runInDurableObject(stub, async (_instance, state) => {
			const row = state.storage.sql
				.exec<{ count: number }>("SELECT count FROM abuse WHERE id = 1")
				.one();
			expect(row.count).toBe(ABUSE_THRESHOLD);
		});
	});

	it("starts a new window exactly at the reset boundary", async () => {
		const stub = env.ENFORCEMENT.getByName("test:reset-boundary");

		expect(await stub.limitFixedWindow(1, 10, 5_000)).toEqual({
			allowed: true
		});
		expect(await stub.limitFixedWindow(1, 10, 14_999)).toEqual({
			allowed: false,
			retryAfterSeconds: 1
		});
		expect(await stub.limitFixedWindow(1, 10, 15_000)).toEqual({
			allowed: true
		});
		expect(await stub.fixedWindowUsage(15_000)).toEqual({
			count: 1,
			resetAt: 25_000
		});
	});

	it("keeps active state and reschedules its alarm to the latest expiry", async () => {
		const stub = env.ENFORCEMENT.getByName("test:active-alarm");
		const now = Date.now();
		const fixedWindowExpiry = now + 60_000;
		const blockExpiry = now + 120_000;

		await stub.limitFixedWindow(1, 60, now);
		await stub.recordBannedAttempt(
			{ threshold: 1, windowSeconds: 30, blockSeconds: 120 },
			now
		);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(blockExpiry);
		});

		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(await stub.fixedWindowUsage(now)).toEqual({
			count: 1,
			resetAt: fixedWindowExpiry
		});
		expect(await stub.isBlocked(now)).toBe(true);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(blockExpiry);
		});
	});

	it("deletes all stored state when the alarm finds every expiry elapsed", async () => {
		const stub = env.ENFORCEMENT.getByName("test:expired-alarm");
		const now = Date.now();

		await stub.limitFixedWindow(1, 60, now);
		await stub.recordBannedAttempt(
			{ threshold: 1, windowSeconds: 60, blockSeconds: 120 },
			now
		);
		await runInDurableObject(stub, async (_instance, state) => {
			state.storage.sql.exec(
				"UPDATE fixed_window SET reset_at = ? WHERE id = 1",
				now - 1
			);
			state.storage.sql.exec(
				"UPDATE abuse SET reset_at = ?, blocked_until = ? WHERE id = 1",
				now - 1,
				now - 1
			);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (_instance, state) => {
			const tables = state.storage.sql
				.exec<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('fixed_window', 'abuse')"
				)
				.toArray();
			expect(tables).toEqual([]);
			expect(await state.storage.getAlarm()).toBeNull();
		});
		expect(await stub.fixedWindowUsage()).toBeNull();
	});
});
