export interface RateLimiter {
	limit(key: string): Promise<RateLimitResult>;
}

export type RateLimitResult =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

export interface FixedWindowUsage {
	count: number;
	resetAt: number;
}

export class DurableObjectFixedWindow implements RateLimiter {
	constructor(
		private readonly enforcement: DurableObjectNamespace<
			import("./enforcement").Enforcement
		>,
		private readonly maxRequests: number,
		private readonly windowSeconds: number
	) {}

	async limit(key: string): Promise<RateLimitResult> {
		return this.enforcement
			.getByName(key)
			.limitFixedWindow(this.maxRequests, this.windowSeconds);
	}

	async usage(key: string): Promise<FixedWindowUsage | null> {
		return this.enforcement.getByName(key).fixedWindowUsage();
	}
}
