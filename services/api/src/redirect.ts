import type { Context } from "hono";
import { errorResponse } from "./errors";
import { SLUG_RE } from "./slugs";
import type { Env } from "./worker";

export async function redirectSlug(c: Context<{ Bindings: Env }>): Promise<Response> {
	const slug = c.req.param("slug");
	if (slug === undefined) {
		return errorResponse(404, "not_found", "Link not found.");
	}

	// Every slug ever issued (v1 and v2) matches SLUG_RE. The UWU namespace also
	// holds colon-prefixed bookkeeping keys (ratelimit:, banned:, later meta:);
	// gating on the regex keeps a crafted path from ever reading those.
	if (!SLUG_RE.test(slug)) {
		return c.redirect("https://app.uwu.land/404", 302);
	}

	const url = await c.env.UWU.get(slug);

	if (url === null) {
		return c.redirect("https://app.uwu.land/404", 302);
	}

	c.executionCtx.waitUntil(recordClick(c.env, c.req.raw, slug));
	return c.redirect(url, 302);
}

async function recordClick(env: Env, request: Request, slug: string): Promise<void> {
	await incrementClicks(env.CLICKS, slug);
	env.CLICK_EVENTS.writeDataPoint({
		blobs: [slug, countryFor(request), refererHostFor(request)],
		indexes: [slug]
	});
}

async function incrementClicks(kv: KVNamespace, slug: string): Promise<void> {
	const current = Number.parseInt((await kv.get(slug)) ?? "0", 10);
	const next = Number.isFinite(current) ? current + 1 : 1;
	await kv.put(slug, String(next));
}

function countryFor(request: Request): string {
	const country = request.cf?.country;
	return typeof country === "string" ? country : "";
}

function refererHostFor(request: Request): string {
	const referer = request.headers.get("referer");
	if (referer === null) {
		return "";
	}

	try {
		return new URL(referer).hostname;
	} catch {
		return "";
	}
}
