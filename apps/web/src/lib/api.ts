import type {
	ApiError,
	CreateKeyRequest,
	CreateKeyResponse,
	CreateLinkRequest,
	CreateLinkResponse,
	ListKeysResponse,
	ListLinksResponse,
	MeResponse
} from "@uwu/shared";

const API_BASE = import.meta.env.VITE_UWU_API_URL ?? "https://uwu.land";

export class UwuApiError extends Error {
	constructor(public readonly error: ApiError) {
		super(error.message);
		this.name = "UwuApiError";
	}

	get code(): string {
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

async function parseErrorEnvelope(response: Response): Promise<ApiError> {
	try {
		const body = (await response.json()) as Partial<ApiError>;
		if (typeof body.code === "string" && typeof body.message === "string") {
			return {
				status: typeof body.status === "number" ? body.status : response.status,
				code: body.code,
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
