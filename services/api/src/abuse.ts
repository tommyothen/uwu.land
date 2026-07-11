export const ABUSE_THRESHOLD = 5;
export const ABUSE_WINDOW_SECONDS = 3_600;
export const IP_BLOCK_SECONDS = 86_400;

export function ipKey(request: Request): string {
	return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export async function isIpBlocked(
	enforcement: DurableObjectNamespace<import("./enforcement").Enforcement>,
	ip: string
): Promise<boolean> {
	return enforcement.getByName(`abuse:${ip}`).isBlocked();
}

export async function recordBannedAttempt(
	enforcement: DurableObjectNamespace<import("./enforcement").Enforcement>,
	ip: string
): Promise<void> {
	await enforcement.getByName(`abuse:${ip}`).recordBannedAttempt({
		threshold: ABUSE_THRESHOLD,
		windowSeconds: ABUSE_WINDOW_SECONDS,
		blockSeconds: IP_BLOCK_SECONDS
	});
}
