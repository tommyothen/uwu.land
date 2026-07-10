export function normalizeUrl(url: string): string {
	const normalized = new URL(url);
	normalized.protocol = normalized.protocol.toLowerCase();
	normalized.hostname = normalized.hostname.toLowerCase();
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
