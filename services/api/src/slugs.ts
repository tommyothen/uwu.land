import { nanoid } from "nanoid";

export const SLUG_RE = /^[\w-]{3,16}$/;
/**
 * Slugs nobody may claim, matched case-insensitively. Covers the first path
 * segment of every non-redirect route this worker serves, every apps/web
 * route, and the usual site and account paths, so `uwu.land/login` and the
 * like can never point at a phishing page. Existing links are unaffected;
 * this only gates creation.
 */
export const RESERVED: ReadonlySet<string> = new Set([
	// services/api routes
	"api",
	"webhooks",
	// apps/web routes
	"404",
	"acceptable-use",
	"dashboard",
	"dev",
	"docs",
	"privacy",
	"refunds",
	"sign-in",
	"sign-up",
	"terms",
	// Common site, account and support paths
	"about",
	"abuse",
	"account",
	"admin",
	"app",
	"assets",
	"billing",
	"checkout",
	"contact",
	"help",
	"legal",
	"login",
	"logout",
	"mail",
	"pricing",
	"register",
	"report",
	"security",
	"settings",
	"signin",
	"signup",
	"static",
	"status",
	"support",
	"www"
]);

export type IdGenerator = () => string;

/**
 * Length of a generated slug. The redirect is unauthenticated and cannot be
 * rate limited without a storage read on every hit, so the slug space itself
 * has to make guessing live links impractical: 64^8 is about 2.8e14, against
 * about 1e9 for the 5 characters issued before. Older, shorter slugs keep
 * working.
 */
const GENERATED_SLUG_LENGTH = 8;

export const randomSlug: IdGenerator = () => nanoid(GENERATED_SLUG_LENGTH);

export function isReservedSlug(slug: string): boolean {
	return RESERVED.has(slug.toLowerCase());
}

export function isValidCustomSlug(slug: string): boolean {
	return SLUG_RE.test(slug) && !isReservedSlug(slug);
}

export async function generateSlug(
	kv: KVNamespace,
	generateId: IdGenerator = randomSlug,
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
