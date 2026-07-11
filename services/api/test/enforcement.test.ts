import { env, runInDurableObject } from "cloudflare:test";
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
});
