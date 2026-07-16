import type { TierLimits } from "./tiers";

export interface CreateLinkRequest {
	url: string;
	slug?: string;
	external_ref?: string;
}

export interface CreateLinkResponse {
	slug: string;
	short_url: string;
	url: string;
}

export interface LinkSummary {
	slug: string;
	short_url: string;
	url: string;
	clicks: number;
	external_ref?: string;
	created_at: string;
}

export interface ListLinksResponse {
	links: LinkSummary[];
	cursor?: string;
}

export interface ApiKeySummary {
	id: string;
	name: string;
	display_prefix: string;
	created_at: string;
	last_used_at: string | null;
}

export interface ListKeysResponse {
	keys: ApiKeySummary[];
}

export interface CreateKeyRequest {
	name: string;
}

export interface CreateKeyResponse {
	id: string;
	name: string;
	/** Shown once at creation; never retrievable again. */
	secret: string;
	display_prefix: string;
}

export interface MeResponse {
	user_id: string;
	tier: "free" | "pro";
	hasBillingHistory: boolean;
	limits: TierLimits;
	usage: {
		createdToday: number;
		apiKeys: number;
		resetAt: string | null;
	};
}

export interface BillingCheckoutRequest {
	cadence: "monthly" | "yearly";
}

export interface BillingCheckoutResponse {
	url: string;
}

export interface BillingPortalResponse {
	url: string;
}

export interface LinkStatsResponse {
	slug: string;
	clicks: number;
}

export interface ApiError {
	status: number;
	code: string;
	message: string;
	retry_after?: number;
}

export type ErrorCode =
	| "invalid_body"
	| "slug_taken"
	| "slug_reserved"
	| "url_banned"
	| "ip_blocked"
	| "rate_limited"
	| "not_found"
	| "unauthorized"
	| "forbidden"
	| "key_limit"
	| "already_subscribed"
	| "account_deleted"
	| "billing_unavailable"
	| "publication_pending";
