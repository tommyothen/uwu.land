import { errorResponse } from "./errors";
import type { Env } from "./worker";

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

let warnedUnconfigured = false;

/**
 * Checks the Turnstile token an anonymous create carries. Returns the error
 * response to send, or null when the caller may proceed.
 *
 * Fails closed: a missing token, a rejected token, and an unreachable
 * siteverify all refuse the create. The one exception is an unset
 * TURNSTILE_SECRET_KEY, which skips the check entirely so the code can deploy
 * before the secret exists (see docs/decisions.md).
 */
export async function turnstileRejection(
	env: Env,
	token: string | undefined,
	ip: string
): Promise<Response | null> {
	const secret = env.TURNSTILE_SECRET_KEY;
	if (secret === undefined || secret === "") {
		if (!warnedUnconfigured) {
			warnedUnconfigured = true;
			console.warn(
				"TURNSTILE_SECRET_KEY is unset: anonymous creates are not human-checked."
			);
		}
		return null;
	}

	if (token === undefined || token === "") {
		return errorResponse(
			400,
			"turnstile_required",
			"Anonymous links need a Turnstile token."
		);
	}

	return (await verifyToken(secret, token, ip))
		? null
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
