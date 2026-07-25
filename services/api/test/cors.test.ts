import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker";
import worker from "../src/worker";

type TestFetch = (
	request: Request,
	env: Env,
	ctx: ExecutionContext
) => Promise<Response>;

const workerFetch = worker.fetch as TestFetch;

const devOrigin = "http://localhost:3000";

function withDevOrigin(value: string): Env {
	return { ...(env as Env), CORS_DEV_ORIGIN: value } as unknown as Env;
}

function preflight(origin: string): Request {
	return new Request("https://uwu.land/api/v1/links", {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Method": "POST"
		}
	});
}

describe("CORS on /api/v1", () => {
	it("allows the production dashboard origin", async () => {
		const response = await workerFetch(
			preflight("https://app.uwu.land"),
			env as Env,
			createExecutionContext()
		);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://app.uwu.land"
		);
	});

	it("allows the dev dashboard origin when CORS_DEV_ORIGIN names it", async () => {
		const response = await workerFetch(
			preflight(devOrigin),
			withDevOrigin(devOrigin),
			createExecutionContext()
		);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			devOrigin
		);
	});

	it("does not allow the dev dashboard origin when CORS_DEV_ORIGIN is empty", async () => {
		const response = await workerFetch(
			preflight(devOrigin),
			withDevOrigin(""),
			createExecutionContext()
		);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("still allows production when CORS_DEV_ORIGIN is set", async () => {
		const response = await workerFetch(
			preflight("https://app.uwu.land"),
			withDevOrigin(devOrigin),
			createExecutionContext()
		);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://app.uwu.land"
		);
	});

	it("does not allow other origins", async () => {
		const response = await workerFetch(
			preflight("https://evil.example"),
			env as Env,
			createExecutionContext()
		);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});
});
