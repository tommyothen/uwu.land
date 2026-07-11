import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createKey,
	createLink,
	deleteKey,
	deleteLink,
	getMe,
	listKeys,
	listLinks,
	UwuApiError
} from "./api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" }
	});
}

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	fetchMock.mockReset();
	vi.unstubAllGlobals();
});

function lastRequest(): { url: string; init: RequestInit } {
	const call = fetchMock.mock.calls.at(-1);
	if (!call) {
		throw new Error("fetch was not called");
	}
	return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

describe("createLink", () => {
	it("POSTs anonymously without an Authorization header", async () => {
		const created = {
			slug: "abc12",
			short_url: "https://uwu.land/abc12",
			url: "https://example.com"
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(created, 201));

		const result = await createLink({ url: "https://example.com" }, null);

		const { url, init } = lastRequest();
		expect(url).toBe("https://uwu.land/api/v1/links");
		expect(init.method).toBe("POST");
		expect(new Headers(init.headers).has("Authorization")).toBe(false);
		expect(JSON.parse(init.body as string)).toEqual({
			url: "https://example.com"
		});
		expect(result).toEqual(created);
	});

	it("sends a Bearer token when provided", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{ slug: "a", short_url: "https://uwu.land/a", url: "https://e.com" },
				201
			)
		);

		await createLink({ url: "https://e.com", slug: "mine" }, "jwt-token");

		const { init } = lastRequest();
		expect(new Headers(init.headers).get("Authorization")).toBe(
			"Bearer jwt-token"
		);
	});

	it("throws UwuApiError with the envelope code on failure", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{ status: 409, code: "slug_taken", message: "Slug is already taken." },
				409
			)
		);

		const error = await createLink({ url: "https://e.com" }, null).catch(
			(e: unknown) => e
		);
		expect(error).toBeInstanceOf(UwuApiError);
		expect((error as UwuApiError).code).toBe("slug_taken");
		expect((error as UwuApiError).message).toBe("Slug is already taken.");
	});

	it("throws a generic UwuApiError when the body is not an envelope", async () => {
		fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

		const error = await createLink({ url: "https://e.com" }, null).catch(
			(e: unknown) => e
		);
		expect(error).toBeInstanceOf(UwuApiError);
		expect((error as UwuApiError).code).toBe("unknown");
	});
});

describe("listLinks", () => {
	it("GETs with the token and no cursor by default", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ links: [] }));

		await listLinks("tok");

		const { url, init } = lastRequest();
		expect(url).toBe("https://uwu.land/api/v1/links");
		expect(init.method).toBe("GET");
		expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
	});

	it("wires the cursor as a query parameter", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ links: [] }));

		await listLinks("tok", "abc+/=cursor");

		const { url } = lastRequest();
		expect(url).toBe(
			`https://uwu.land/api/v1/links?cursor=${encodeURIComponent("abc+/=cursor")}`
		);
	});
});

describe("deleteLink", () => {
	it("resolves void on 204", async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await expect(deleteLink("abc12", "tok")).resolves.toBeUndefined();

		const { url, init } = lastRequest();
		expect(url).toBe("https://uwu.land/api/v1/links/abc12");
		expect(init.method).toBe("DELETE");
	});
});

describe("keys and me", () => {
	it("getMe returns the parsed body", async () => {
		const me = {
			user_id: "user_1",
			tier: "free",
			limits: { createPerDay: 120, apiKeys: 1 }
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(me));

		expect(await getMe("tok")).toEqual(me);
		expect(lastRequest().url).toBe("https://uwu.land/api/v1/me");
	});

	it("createKey POSTs the name and returns the secret payload", async () => {
		const created = {
			id: "k1",
			name: "bot",
			secret: "uwu_secret",
			display_prefix: "uwu_secret12"
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(created, 201));

		expect(await createKey({ name: "bot" }, "tok")).toEqual(created);
		const { url, init } = lastRequest();
		expect(url).toBe("https://uwu.land/api/v1/keys");
		expect(init.method).toBe("POST");
	});

	it("listKeys GETs /keys", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ keys: [] }));

		expect(await listKeys("tok")).toEqual({ keys: [] });
		expect(lastRequest().url).toBe("https://uwu.land/api/v1/keys");
	});

	it("deleteKey resolves void on 204", async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await expect(deleteKey("k1", "tok")).resolves.toBeUndefined();
		const { url, init } = lastRequest();
		expect(url).toBe("https://uwu.land/api/v1/keys/k1");
		expect(init.method).toBe("DELETE");
	});
});
