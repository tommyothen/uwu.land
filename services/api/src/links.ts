import { type CreateLinkResponse, TIERS } from "@uwu/shared";
import type { Context } from "hono";
import { z } from "zod";
import { isBannedHostname } from "./banned";
import { errorResponse } from "./errors";
import { KvFixedWindow } from "./rate-limit";
import { generateSlug, type IdGenerator } from "./slugs";
import type { Env } from "./worker";

const createLinkSchema = z.object({
	url: z.string().url(),
	slug: z.string().optional(),
	external_ref: z.string().optional()
});

export interface LinkHandlersOptions {
	generateId?: IdGenerator;
}

export async function createAnonymousLink(
	c: Context<{ Bindings: Env }>,
	options: LinkHandlersOptions = {}
): Promise<Response> {
	const body = await readJson(c.req.raw);
	const parsed = createLinkSchema.safeParse(body);
	if (!parsed.success) {
		return errorResponse(400, "invalid_body", "Invalid request body.");
	}

	if (parsed.data.slug !== undefined || parsed.data.external_ref !== undefined) {
		return errorResponse(
			403,
			"forbidden",
			"Custom slugs need an account. Coming soon."
		);
	}

	const destination = new URL(parsed.data.url);
	if (!["http:", "https:"].includes(destination.protocol)) {
		return errorResponse(400, "invalid_body", "URL must use http or https.");
	}

	if (isOwnHostname(destination.hostname)) {
		return errorResponse(400, "invalid_body", "uwu.land URLs are not allowed.");
	}

	if (await isBannedHostname(c.env.UWU, destination.hostname)) {
		return errorResponse(400, "url_banned", "URL host is banned.");
	}

	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	const limiter = new KvFixedWindow(c.env.UWU, TIERS.anon.createPerDay, 86_400);
	if (!(await limiter.limit(`anon:${ip}`))) {
		return errorResponse(429, "rate_limited", "Rate limit exceeded.");
	}

	const slug = await generateSlug(c.env.UWU, options.generateId);
	await c.env.UWU.put(slug, destination.toString());
	await c.env.CLICKS.put(slug, "0");

	const response: CreateLinkResponse = {
		slug,
		short_url: `https://uwu.land/${slug}`,
		url: destination.toString()
	};
	return Response.json(response, { status: 201 });
}

export async function linkStats(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	const slug = c.req.param("slug");
	if (slug === undefined) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	if ((await c.env.UWU.get(slug)) === null) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	const clicks = Number.parseInt((await c.env.CLICKS.get(slug)) ?? "0", 10);
	return Response.json({
		slug,
		clicks: Number.isFinite(clicks) ? clicks : 0
	});
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

function isOwnHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return lower === "uwu.land" || lower.endsWith(".uwu.land");
}
