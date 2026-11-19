import type {
	ApiError,
	BillingCheckoutRequest,
	BillingCheckoutResponse,
	BillingPortalResponse,
	CreateKeyRequest,
	CreateKeyResponse,
	CreateLinkRequest,
	CreateLinkResponse,
	ErrorCode,
	ListKeysResponse,
	ListLinksResponse,
	MeResponse
} from "@uwu/shared";
import { isErrorCode } from "@uwu/shared";

const API_BASE = import.meta.env.VITE_UWU_API_URL ?? "https://uwu.land";

/** The API's error envelope, or "unknown" for a response that is not one. */
export type ClientApiError = Omit<ApiError, "code"> & {
	code: ErrorCode | "unknown";
};

export class UwuApiError extends Error {
	constructor(public readonly error: ClientApiError) {
		super(error.message);
		this.name = "UwuApiError";
	}

	get code(): ClientApiError["code"] {
		return this.error.code;
	}
}

async function request<T>(
	method: "GET" | "POST" | "DELETE",
	path: string,
	token: string | null,
	body?: unknown
): Promise<T> {
	const headers = new Headers();
	if (token !== null) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	if (body !== undefined) {
		headers.set("content-type", "application/json");
	}

	const response = await fetch(`${API_BASE}/api/v1${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	if (!response.ok) {
		throw new UwuApiError(await parseErrorEnvelope(response));
	}
	if (response.status === 204) {
		return undefined as T;
	}
	return (await response.json()) as T;
}

async function parseErrorEnvelope(
	response: Response
): Promise<ClientApiError> {
	try {
		const body = (await response.json()) as Partial<Record<keyof ApiError, unknown>>;
		if (typeof body.code === "string" && typeof body.message === "string") {
			return {
				status: typeof body.status === "number" ? body.status : response.status,
				// A code newer than this build still carries a usable message.
				code: isErrorCode(body.code) ? body.code : "unknown",
				message: body.message
			};
		}
	} catch {
		// fall through to the generic error
	}
	return {
		status: response.status,
		code: "unknown",
		message: "Something went wrong. Please try again."
	};
}

export async function createLink(
	body: CreateLinkRequest,
	token: string | null
): Promise<CreateLinkResponse> {
	return request("POST", "/links", token, body);
}

export async function listLinks(
	token: string,
	cursor?: string
): Promise<ListLinksResponse> {
	const query =
		cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
	return request("GET", `/links${query}`, token);
}

export async function deleteLink(slug: string, token: string): Promise<void> {
	return request("DELETE", `/links/${encodeURIComponent(slug)}`, token);
}

export async function getMe(token: string): Promise<MeResponse> {
	return request("GET", "/me", token);
}

export async function createBillingCheckout(
	token: string,
	cadence: BillingCheckoutRequest["cadence"]
): Promise<BillingCheckoutResponse> {
	return request("POST", "/billing/checkout", token, { cadence });
}

export async function createBillingPortal(
	token: string
): Promise<BillingPortalResponse> {
	return request("POST", "/billing/portal", token);
}

export async function createKey(
	body: CreateKeyRequest,
	token: string
): Promise<CreateKeyResponse> {
	return request("POST", "/keys", token, body);
}

export async function listKeys(token: string): Promise<ListKeysResponse> {
	return request("GET", "/keys", token);
}

export async function deleteKey(id: string, token: string): Promise<void> {
	return request("DELETE", `/keys/${encodeURIComponent(id)}`, token);
}
