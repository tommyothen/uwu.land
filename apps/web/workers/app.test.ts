// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestHandler } = vi.hoisted(() => ({
	requestHandler: vi.fn(async (_request: Request) => new Response("ok"))
}));

// The real handler would pull in `virtual:react-router/server-build`, which only
// exists inside a React Router build. Stub the factory so the worker's own
// response handling is what's under test.
vi.mock("react-router", () => ({
	createRequestHandler: () => requestHandler
}));

const { default: worker } = await import("./app");

function fetchWorker(path = "/") {
	// A plain Request lacks the incoming-request `cf` properties workerd adds;
	// nothing under test reads them.
	return worker.fetch(
		new Request(`https://app.uwu.land${path}`) as Parameters<
			typeof worker.fetch
		>[0]
	);
}

describe("web worker security headers", () => {
	beforeEach(() => {
		requestHandler.mockReset();
		requestHandler.mockImplementation(async () => new Response("ok"));
	});

	it("refuses to be framed by anyone", async () => {
		const response = await fetchWorker();
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("Content-Security-Policy")).toBe(
			"frame-ancestors 'none'"
		);
	});

	it("blocks MIME sniffing and leaks no path across origins", async () => {
		const response = await fetchWorker();
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Referrer-Policy")).toBe(
			"strict-origin-when-cross-origin"
		);
	});

	it("never ships a script-src or connect-src that could break Clerk", async () => {
		const response = await fetchWorker();
		const csp = response.headers.get("Content-Security-Policy") ?? "";
		expect(csp).not.toMatch(/script-src|connect-src|default-src/);
	});

	it("guards redirects, whose headers are immutable", async () => {
		requestHandler.mockImplementation(async () =>
			Response.redirect("https://app.uwu.land/sign-in", 302)
		);
		const response = await fetchWorker("/dashboard");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(
			"https://app.uwu.land/sign-in"
		);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
	});

	it("guards error responses", async () => {
		requestHandler.mockImplementation(
			async () => new Response("boom", { status: 500 })
		);
		const response = await fetchWorker("/dashboard");
		expect(response.status).toBe(500);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
	});

	it("overrides a weaker policy set downstream", async () => {
		requestHandler.mockImplementation(
			async () =>
				new Response("ok", {
					headers: { "Referrer-Policy": "unsafe-url" }
				})
		);
		const response = await fetchWorker();
		expect(response.headers.get("Referrer-Policy")).toBe(
			"strict-origin-when-cross-origin"
		);
	});

	it("leaves the body and the route's own headers alone", async () => {
		requestHandler.mockImplementation(
			async () =>
				new Response("<!DOCTYPE html>", {
					headers: {
						"Content-Type": "text/html",
						"Set-Cookie": "__session=abc"
					}
				})
		);
		const response = await fetchWorker();
		expect(response.headers.get("Content-Type")).toBe("text/html");
		expect(response.headers.get("Set-Cookie")).toBe("__session=abc");
		await expect(response.text()).resolves.toBe("<!DOCTYPE html>");
	});
});
