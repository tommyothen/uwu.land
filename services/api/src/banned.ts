// Path signatures of redirect campaigns that rotate throwaway domains faster
// than hostname bans can follow. Matched against the destination pathname
// after percent-decoding, lowercasing and collapsing repeated slashes, since
// `new URL` does none of those and the campaign's servers would.
const BANNED_PATHS = new Set([
	// TDS spam seen October 2026: https://<random>.<random7>.com/wqamhcsom?r=..&t=..
	"/wqamhcsom"
]);

export function isBannedPath(pathname: string): boolean {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return false;
	}
	const normalised = decoded.toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
	return BANNED_PATHS.has(normalised);
}

export async function isBannedHostname(
	kv: KVNamespace,
	hostname: string
): Promise<boolean> {
	const labels = hostname.toLowerCase().split(".");

	// Stops before the final label on purpose: a `banned:com` key — one typo
	// during incident response is enough — would otherwise block every .com
	// destination and take link creation down service-wide.
	for (let index = 0; index < labels.length - 1; index++) {
		const candidate = labels.slice(index).join(".");
		if ((await kv.get(`banned:${candidate}`)) !== null) {
			return true;
		}
	}

	return false;
}
