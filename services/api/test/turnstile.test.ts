import { createExecutionContext, env } from "cloudflare:test";
import { apiKeys, users } from "@uwu/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashKey } from "../src/keys";
import type { Env } from "../src/worker";
import worker from "../src/worker";
import { resetD1 } from "./helpers/d1";

type TestFetch = (
	request: Request,
	env: Env,
	ctx: ExecutionContext
) => Promise<Response>;

const workerFetch = worker.fetch as TestFetch;

// Cloudflare's documented always-pass test secret; siteverify is stubbed anyway.
const SECRET = "1x0000000000000000000000000000000AA";
const turnstileEnv = { ...env, TURNSTILE_SECRET_KEY: SECRET } as Env;

function createRequest(body: unknown, ip = "203.0.113.120"): Request {
	return new Request("https://uwu.land/api/v1/links", {
		cf: {},
		method: "POST",
		headers: { "CF-Connecting-IP": ip, "content-type": "application/json" },
		body: JSON.stringify(body)
	});
}

/** Stubs siteverify with a fixed outcome and records each form it receives. */
function stubSiteverify(success: boolean) {
	const forms: Record<string, string | File>[] = [];
	const siteverify = vi.fn<typeof fetch>(async (input, init) => {
		expect(String(input)).toBe(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify"
		);
		if (!(init?.body instanceof FormData)) {
			throw new Error("siteverify expects a form body");
		}
		forms.push(Object.fromEntries(init.body));
		return Response.json({ success });
	});
	vi.stubGlobal("fetch", siteverify);
	return { siteverify, forms };
}

async function create(body: unknown, testEnv: Env, ip?: string) {
	const response = await workerFetch(
		createRequest(body, ip),
		testEnv,
		createExecutionContext()
	);
	return { status: response.status, body: await response.json<{ code?: string }>() };
}

beforeEach(async () => {
	await resetD1(env.DB);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Turnstile on anonymous creates", () => {
	it("rejects an anonymous create without a token", async () => {
		const { siteverify } = stubSiteverify(true);

		const result = await create({ url: "https://ts-missing.example/" }, turnstileEnv);

		expect(result).toMatchObject({ status: 400, body: { code: "turnstile_required" } });
		expect(siteverify).not.toHaveBeenCalled();
	});

	it("rejects a token siteverify does not accept", async () => {
		stubSiteverify(false);

		const result = await create(
			{ url: "https://ts-invalid.example/", turnstile_token: "bad" },
			turnstileEnv
		);

		expect(result).toMatchObject({ status: 403, body: { code: "turnstile_failed" } });
	});

	it("fails closed when siteverify is unreachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => {
				throw new TypeError("network down");
			})
		);

		const result = await create(
			{ url: "https://ts-down.example/", turnstile_token: "tok" },
			turnstileEnv
		);

		expect(result).toMatchObject({ status: 403, body: { code: "turnstile_failed" } });
	});

	it("creates once siteverify accepts, passing the secret, token and client IP", async () => {
		const { forms } = stubSiteverify(true);

		const result = await create(
			{ url: "https://ts-valid.example/", turnstile_token: "tok_ok" },
			turnstileEnv,
			"203.0.113.121"
		);

		expect(result.status).toBe(201);
		expect(forms).toEqual([{
			secret: SECRET,
			response: "tok_ok",
			remoteip: "203.0.113.121"
		}]);
	});

	it("skips verification while the secret is unset", async () => {
		const { siteverify } = stubSiteverify(false);

		const result = await create({ url: "https://ts-unset.example/" }, env as Env);

		expect(result.status).toBe(201);
		expect(siteverify).not.toHaveBeenCalled();
	});

	it("never asks API key callers for a token", async () => {
		const { siteverify } = stubSiteverify(false);
		const secret = "uwu_turnstile0000000000000000000000";
		const db = drizzle(env.DB);
		await db.insert(users).values({ id: "user_ts", tier: "free" }).run();
		await db
			.insert(apiKeys)
			.values({
				id: "key_ts",
				userId: "user_ts",
				name: "Turnstile test",
				keyHash: await hashKey(secret),
				displayPrefix: secret.slice(0, 12)
			})
			.run();
		const request = createRequest({ url: "https://ts-keyed.example/" });
		request.headers.set("authorization", `Bearer ${secret}`);

		const response = await workerFetch(request, turnstileEnv, createExecutionContext());

		expect(response.status).toBe(201);
		expect(siteverify).not.toHaveBeenCalled();
	});
});

describe("anonymous per-domain daily cap", () => {
	it("caps fresh links per registrable domain across subdomains and IPs", async () => {
		for (let index = 0; index < 10; index++) {
			const result = await create(
				{ url: `https://s${index}.capped.co.uk/x` },
				env as Env,
				`198.51.100.${index}`
			);
			expect(result.status).toBe(201);
		}

		const over = await workerFetch(
			createRequest({ url: "https://another.capped.co.uk/y" }, "198.51.100.50"),
			env as Env,
			createExecutionContext()
		);
		expect(over.status).toBe(429);
		expect(await over.json()).toMatchObject({ code: "domain_rate_limited" });
		expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);

		// A sibling under the same public suffix is a different registrant.
		const sibling = await create({ url: "https://other.co.uk/" }, env as Env, "198.51.100.51");
		expect(sibling.status).toBe(201);
	});

	it("does not count dedupe hits against the cap", async () => {
		for (let index = 0; index < 12; index++) {
			const result = await create(
				{ url: "https://deduped.example/same" },
				env as Env,
				`198.51.100.${100 + index}`
			);
			expect(result.status).toBe(201);
		}
	});
});
