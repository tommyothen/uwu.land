const API_KEY_PREFIX = "uwu_";
const API_KEY_RANDOM_LENGTH = 32;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export interface GeneratedApiKey {
	secret: string;
	hash: string;
	displayPrefix: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
	const secret = `${API_KEY_PREFIX}${randomBase62(API_KEY_RANDOM_LENGTH)}`;
	return {
		secret,
		hash: await hashKey(secret),
		displayPrefix: secret.slice(0, 12)
	};
}

export async function hashKey(secret: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret)
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function randomBase62(length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let value = "";
	for (const byte of bytes) {
		value += BASE62[byte % BASE62.length];
	}
	return value;
}
