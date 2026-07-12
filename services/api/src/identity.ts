import { hashKey } from "./keys";

export function normalizeEmail(email: string): string {
	const normalized = email.trim().toLowerCase();
	const at = normalized.lastIndexOf("@");
	const domain = at === -1 ? "" : normalized.slice(at + 1);
	let local = at === -1 ? normalized : normalized.slice(0, at);

	const plus = local.indexOf("+");
	if (plus !== -1) {
		local = local.slice(0, plus);
	}
	if (domain === "gmail.com" || domain === "googlemail.com") {
		local = local.replaceAll(".", "");
	}

	return at === -1 ? local : `${local}@${domain}`;
}

export async function emailIdentityHash(email: string): Promise<string> {
	return hashKey(normalizeEmail(email));
}
