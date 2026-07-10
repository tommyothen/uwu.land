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

	it("allows the localhost dev dashboard origin", async () => {
		const response = await workerFetch(
			preflight("http://localhost:3000"),
			env as Env,
			createExecutionContext()
		);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:3000"
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
