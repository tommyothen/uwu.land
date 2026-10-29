import { createExecutionContext, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { createApp } from "../src/worker";

it.each([
	["GET", "/"],
	["GET", "/favicon.ico"],
	["GET", "/api/v1/me"],
	["OPTIONS", "/api/v1/links"],
	["POST", "/webhooks/stripe"]
])("sets security headers on %s %s", async (method, path) => {
	const response = await createApp().fetch(
		new Request(`https://uwu.land${path}`, { method }),
		env,
		createExecutionContext()
	);
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(response.headers.get("X-Frame-Options")).toBe("DENY");
	expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
});
