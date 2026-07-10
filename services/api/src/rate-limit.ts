export interface RateLimiter {
	limit(key: string): Promise<boolean>;
}

interface WindowCounter {
	count: number;
	resetAt: number;
}

export class KvFixedWindow implements RateLimiter {
	constructor(
		private readonly kv: KVNamespace,
		private readonly maxRequests: number,
		private readonly windowSeconds: number
	) {}

	async limit(key: string): Promise<boolean> {
		const now = Date.now();
		const kvKey = `ratelimit:${key}`;
		const current = await this.readCounter(kvKey);
		const counter =
			current === null || current.resetAt <= now
				? { count: 0, resetAt: now + this.windowSeconds * 1000 }
				: current;

		if (counter.count >= this.maxRequests) {
			return false;
		}

		counter.count += 1;
		const ttl = Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
		await this.kv.put(kvKey, JSON.stringify(counter), { expirationTtl: ttl });
		return true;
	}

	private async readCounter(key: string): Promise<WindowCounter | null> {
		const raw = await this.kv.get(key);
		if (raw === null) {
			return null;
		}

		try {
			const parsed = JSON.parse(raw) as Partial<WindowCounter>;
			if (
				typeof parsed.count === "number" &&
				typeof parsed.resetAt === "number"
			) {
				return { count: parsed.count, resetAt: parsed.resetAt };
			}
		} catch {
			return null;
		}

		return null;
	}
}
