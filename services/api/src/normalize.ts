/**
 * Reduces a hostname to a single spelling. `evil.com.` is the fully qualified
 * form of `evil.com` and resolves to the same host, so leaving the trailing dot
 * on would let one destination wear two identities: one that hostname gates
 * match and one they do not. Returns "" when nothing but dots is left, which
 * callers must reject.
 */
export function canonicalHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/\.+$/, "");
}

export function normalizeUrl(url: string): string {
	const normalized = new URL(url);
	normalized.protocol = normalized.protocol.toLowerCase();
	const hostname = canonicalHostname(normalized.hostname);
	// The hostname setter ignores an empty value, so an all-dots host would keep
	// its original spelling; createLink rejects those before they reach here.
	if (hostname !== "") {
		normalized.hostname = hostname;
	}
	if (
		(normalized.protocol === "http:" && normalized.port === "80") ||
		(normalized.protocol === "https:" && normalized.port === "443")
	) {
		normalized.port = "";
	}
	normalized.hash = "";
	if (normalized.pathname === "/") {
		return normalized.toString().replace(/\/(?=\?|$)/, "");
	}
	return normalized.toString();
}
