export const ABUSE_THRESHOLD = 5;
export const ABUSE_WINDOW_SECONDS = 3_600;
export const IP_BLOCK_SECONDS = 86_400;

interface AbuseCounter {
	count: number;
	resetAt: number;
}

export function ipKey(request: Request): string {
	return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export async function isIpBlocked(
	kv: KVNamespace,
	ip: string
): Promise<boolean> {
	return (await kv.get(`ipban:${ip}`)) !== null;
}

export async function recordBannedAttempt(
	kv: KVNamespace,
	ip: string
): Promise<void> {
	const now = Date.now();
	const current = await readCounter(kv, `abuse:${ip}`);
	const counter =
		current === null || current.resetAt <= now
			? { count: 0, resetAt: now + ABUSE_WINDOW_SECONDS * 1000 }
			: current;

	counter.count += 1;
	const ttl = Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
	await kv.put(`abuse:${ip}`, JSON.stringify(counter), { expirationTtl: ttl });

	if (counter.count >= ABUSE_THRESHOLD) {
		await kv.put(`ipban:${ip}`, "1", { expirationTtl: IP_BLOCK_SECONDS });
	}
}

async function readCounter(
	kv: KVNamespace,
	key: string
): Promise<AbuseCounter | null> {
	const raw = await kv.get(key);
	if (raw === null) {
		return null;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<AbuseCounter>;
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
