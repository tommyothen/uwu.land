import type { Context } from "hono";
import {
	AuthError,
	type AuthOptions,
	type AuthPrincipal,
	resolveAuth
} from "./auth";
import { errorResponse } from "./errors";
import type { Env } from "./worker";

type SessionPrincipal = Extract<AuthPrincipal, { kind: "session" }>;

export async function requireSession(
	c: Context<{ Bindings: Env }>,
	options: { auth?: AuthOptions },
	apiKeyMessage: string
): Promise<SessionPrincipal | Response> {
	let auth: AuthPrincipal;
	try {
		auth = await resolveAuth(c.req.raw, c.env, c.executionCtx, options.auth);
	} catch (error) {
		if (error instanceof AuthError) {
			return errorResponse(401, "unauthorized", "Unauthorized.");
		}
		throw error;
	}

	if (auth.kind === "anon") {
		return errorResponse(401, "unauthorized", "Authentication required.");
	}
	if (auth.kind === "key") {
		return errorResponse(403, "forbidden", apiKeyMessage);
	}
	return auth;
}

export async function readJson(input: Request | string): Promise<unknown> {
	try {
		return typeof input === "string" ? JSON.parse(input) : await input.json();
	} catch {
		return null;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
