// Path signatures of redirect campaigns that rotate throwaway domains faster
// than hostname bans can follow. `new URL` leaves percent-encoding alone, so
// the pathname is decoded before dot segments are resolved, then matched
// case-insensitively with empty segments ignored. That errs towards blocking
// any spelling some origin server might treat as the same path.
const BANNED_PATHS = new Set([
	// TDS spam seen October 2026: https://<random>.<random7>.com/wqamhcsom?r=..&t=..
	"/wqamhcsom"
]);

export function isBannedPath(pathname: string): boolean {
	let decoded = pathname;
	for (let iteration = 0; iteration < 3; iteration++) {
		try {
			const next = decodeURIComponent(decoded);
			if (next === decoded) break;
			decoded = next;
		} catch {
			break;
		}
	}
	const segments: string[] = [];
	for (const segment of decoded.toLowerCase().split("/")) {
		if (segment === "..") segments.pop();
		else if (segment !== "" && segment !== ".") segments.push(segment);
	}
	return BANNED_PATHS.has(`/${segments.join("/")}`);
}

const BAN_WALK_LABELS = 5;

export async function isBannedHostname(
	kv: KVNamespace,
	hostname: string
): Promise<boolean> {
	const labels = hostname.toLowerCase().split(".");

	// Starts at most BAN_WALK_LABELS from the end so the KV reads per create stay
	// bounded however deep a hostname goes; a ban on a longer suffix never
	// matches. Stops before the final label on purpose: a `banned:com` key (one
	// typo during incident response is enough) would otherwise block every .com
	// destination and take link creation down service-wide.
	const first = Math.max(0, labels.length - BAN_WALK_LABELS);
	for (let index = first; index < labels.length - 1; index++) {
		const candidate = labels.slice(index).join(".");
		if ((await kv.get(`banned:${candidate}`)) !== null) {
			return true;
		}
	}

	return false;
}
