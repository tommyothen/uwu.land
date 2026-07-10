import { nanoid } from "nanoid";

export const SLUG_RE = /^[\w-]{3,16}$/;
export const RESERVED = new Set(["api"]);

export type IdGenerator = () => string;

export function isReservedSlug(slug: string): boolean {
	return RESERVED.has(slug.toLowerCase());
}

export function isValidCustomSlug(slug: string): boolean {
	return SLUG_RE.test(slug) && !isReservedSlug(slug);
}

export async function generateSlug(
	kv: KVNamespace,
	generateId: IdGenerator = () => nanoid(5),
	maxAttempts = 20
): Promise<string> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const slug = generateId();
		if (isReservedSlug(slug)) {
			continue;
		}
		const existing = await kv.get(slug);
		if (existing === null) {
			return slug;
		}
	}

	throw new Error("Unable to generate a unique slug");
}
