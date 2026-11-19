import { errorResponse } from "./errors";
import type { Env } from "./worker";

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

let warnedUnconfigured = false;

/**
 * Which anonymous quota a create falls under: `token` for callers that sent a
 * Turnstile token (the homepage), `keyless` for plain API calls that sent none.
 */
export type AnonymousTier = "token" | "keyless";

/**
 * Checks the Turnstile token an anonymous create carries. Returns the tier the
 * caller lands in, or the error response to send.
 *
 * Leaving the token out entirely is allowed and lands in the small keyless
 * tier. A token that is sent fails closed: a rejected token or an unreachable
 * siteverify refuses the create rather than dropping to the keyless tier, so
 * junk tokens cannot dodge it. An unset TURNSTILE_SECRET_KEY skips
 * verification so the code can deploy before the secret exists, but still
 * splits the tiers on whether a token was sent (see docs/decisions.md).
 */
export async function anonymousTier(
	env: Env,
	token: string | undefined,
	ip: string
): Promise<AnonymousTier | Response> {
	if (token === undefined) {
		return "keyless";
	}

	const secret = env.TURNSTILE_SECRET_KEY;
	if (secret === undefined || secret === "") {
		if (!warnedUnconfigured) {
			warnedUnconfigured = true;
			console.warn(
				"TURNSTILE_SECRET_KEY is unset: anonymous tokens are not verified."
			);
		}
		return "token";
	}

	return token !== "" && (await verifyToken(secret, token, ip))
		? "token"
		: errorResponse(
				403,
				"turnstile_failed",
				"Turnstile verification failed. Try again."
			);
}

async function verifyToken(
	secret: string,
	token: string,
	ip: string
): Promise<boolean> {
	const body = new FormData();
	body.append("secret", secret);
	body.append("response", token);
	// ipKey() falls back to these placeholders when there is no real address.
	if (ip !== "direct" && ip !== "unknown") {
		body.append("remoteip", ip);
	}

	try {
		const response = await fetch(SITEVERIFY_URL, {
			method: "POST",
			body,
			signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
		});
		if (!response.ok) {
			return false;
		}
		const outcome = await response.json<{ success?: unknown }>();
		return outcome.success === true;
	} catch {
		return false;
	}
}
