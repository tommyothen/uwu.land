export const ABUSE_THRESHOLD = 5;
export const ABUSE_WINDOW_SECONDS = 3_600;
export const IP_BLOCK_SECONDS = 86_400;

/**
 * The bucket every IP-based control keys on: the anonymous create quota, the
 * stats limit and the abuse block. IPv6 collapses to its /64, the smallest
 * block a single line is handed, so rotating addresses inside one allocation
 * buys nothing. IPv4, including IPv4-mapped IPv6, keys on the bare address.
 */
export function ipKey(request: Request): string {
	// Without runtime metadata, client-supplied IP headers are untrusted.
	if (request.cf == null) return "direct";
	const ip = request.headers.get("CF-Connecting-IP");
	if (ip === null) return "unknown";
	return ip.includes(":") ? ipv6Key(ip) : ip;
}

function ipv6Key(ip: string): string {
	let canonical: string;
	try {
		// The URL parser validates the address and canonicalises its spelling:
		// lowercase, no leading zeros, embedded IPv4 rewritten as hex.
		canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
	} catch {
		return ip;
	}
	const [head = "", tail = ""] = canonical.split("::");
	const left = head === "" ? [] : head.split(":");
	const right = tail === "" ? [] : tail.split(":");
	const zeros = Array.from({ length: 8 - left.length - right.length }, () => "0");
	const hextets = [...left, ...zeros, ...right];

	// ::ffff:a.b.c.d is an IPv4 client and shares the plain IPv4 bucket.
	if (hextets.slice(0, 5).every((hextet) => hextet === "0") && hextets[5] === "ffff") {
		const [high, low] = hextets.slice(6).map((hextet) => Number.parseInt(hextet, 16));
		if (high !== undefined && low !== undefined) {
			return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
		}
	}
	return `${hextets.slice(0, 4).join(":")}::/64`;
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
