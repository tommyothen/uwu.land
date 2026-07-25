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
