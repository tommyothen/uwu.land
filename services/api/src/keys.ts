import { bufferToHex } from "./crypto-utils";

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
	return bufferToHex(digest);
}

// 256 is not a multiple of 62, so the top 8 byte values would over-weight the
// first 8 alphabet characters. Rejecting them keeps every character equally
// likely.
const BASE62_BYTE_LIMIT = 256 - (256 % BASE62.length);

function randomBase62(length: number): string {
	let value = "";
	while (value.length < length) {
		const bytes = new Uint8Array(length);
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte < BASE62_BYTE_LIMIT && value.length < length) {
				value += BASE62[byte % BASE62.length];
			}
		}
	}
	return value;
}
