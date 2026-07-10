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

export interface ApiError {
	status: number;
	code: string;
	message: string;
}

export type ErrorCode =
	| "invalid_body"
	| "slug_taken"
	| "slug_reserved"
	| "url_banned"
	| "rate_limited"
	| "not_found"
	| "unauthorized"
	| "forbidden";
