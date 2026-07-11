import type { Env } from "./worker";

const SOURCE_URL =
	"https://raw.githubusercontent.com/mayzelf/grabify-domains/main/domains.txt";
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const MAX_DOMAINS = 5_000;
const WRITE_BATCH_SIZE = 100;

export async function syncBannedDomains(
	env: Pick<Env, "UWU">,
	fetchImpl: typeof fetch = fetch
): Promise<{ added: number; scanned: number }> {
	let response: Response;
	try {
		response = await fetchImpl(SOURCE_URL);
	} catch {
		return { added: 0, scanned: 0 };
	}

	if (!response.ok) {
		return { added: 0, scanned: 0 };
	}

	let source: string;
	try {
		source = await response.text();
	} catch {
		return { added: 0, scanned: 0 };
	}

	const parsed = source
		.split("\n")
		.map((line) => line.trim().toLowerCase())
		.filter(
			(domain) =>
				domain !== "" && !domain.startsWith("#") && DOMAIN_RE.test(domain)
		)
		.slice(0, MAX_DOMAINS);
	if (parsed.length === 0) {
		return { added: 0, scanned: 0 };
	}
	const domains = [...new Set(parsed)];

	const existing = await existingBannedDomains(env.UWU);
	const missing = domains.filter((domain) => !existing.has(domain));

	for (let index = 0; index < missing.length; index += WRITE_BATCH_SIZE) {
		await Promise.all(
			missing
				.slice(index, index + WRITE_BATCH_SIZE)
				.map(async (domain) => env.UWU.put(`banned:${domain}`, "auto"))
		);
	}

	return { added: missing.length, scanned: parsed.length };
}

async function existingBannedDomains(kv: KVNamespace): Promise<Set<string>> {
	const domains = new Set<string>();
	let cursor: string | undefined;

	do {
		const page = await kv.list({ prefix: "banned:", cursor });
		for (const key of page.keys) {
			domains.add(key.name.slice("banned:".length));
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor !== undefined);

	return domains;
}
