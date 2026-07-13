import { UwuApiError } from "./api";

/** Friendly copy for stable API error codes. */
const ERROR_COPY: Record<string, string> = {
	rate_limited:
		"Daily anonymous limit reached. Try again tomorrow, or sign up for more.",
	slug_taken: "That slug is already taken. Try another one.",
	slug_reserved: "That slug is reserved and can't be used.",
	url_banned: "That destination isn't allowed on uwu.land.",
	invalid_body: "That doesn't look like a valid URL or slug.",
	key_limit: "You've reached your API key limit for this plan.",
	already_subscribed: "You're already on First-Class.",
	billing_unavailable: "Billing is temporarily unavailable. Please try again.",
	forbidden: "You don't have permission to do that.",
	unauthorized: "You need to be signed in to do that.",
	not_found: "We couldn't find that."
};

const FALLBACK = "Something went wrong. Please try again.";

/** Map an unknown thrown value to user-facing copy, keyed on ErrorCode. */
export function friendlyError(error: unknown): string {
	if (error instanceof UwuApiError) {
		return ERROR_COPY[error.code] ?? error.message ?? FALLBACK;
	}
	return FALLBACK;
}
