// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/server", () => ({
	renderToReadableStream: vi.fn(
		async () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("<!DOCTYPE html>"));
					controller.close();
				}
			})
	)
}));

vi.mock("react-router", () => ({
	ServerRouter: () => null
}));

const { default: handleRequest } = await import("./entry.server");

function render(status = 200, headers = new Headers()) {
	return handleRequest(
		new Request("https://app.uwu.land/"),
		status,
		headers,
		{} as never,
		{} as never
	);
}

describe("document responses", () => {
	// The worker sends nosniff, so an undeclared type makes the browser render
	// the page source as text and run none of its scripts.
	it("declare themselves as HTML so nosniff cannot break them", async () => {
		const response = await render();
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8"
		);
	});

	it("keep the status and headers the router asked for", async () => {
		const headers = new Headers({ "Set-Cookie": "__session=abc" });
		const response = await render(404, headers);
		expect(response.status).toBe(404);
		expect(response.headers.get("Set-Cookie")).toBe("__session=abc");
	});
});
