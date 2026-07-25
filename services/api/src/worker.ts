import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AuthOptions } from "./auth";
import { syncBannedDomains } from "./ban-sync";
import {
	createBillingCheckout,
	createBillingPortal
} from "./billing-routes";
import {
	clerkWebhook,
	purgeExpiredAccountTombstones
} from "./clerk-webhook";
import { materializeClickCounts } from "./click-materialization";
import {
	createKey,
	deleteKey,
	listKeys
} from "./keys-routes";
import { reconcilePendingLinks } from "./link-reconciliation";
import {
	createLink,
	deleteLink,
	getLink,
	linkStats,
	listLinks,
	me
} from "./links";
import { redirectSlug } from "./redirect";
import type { IdGenerator } from "./slugs";
import { sweepDeletedUserSubscriptions } from "./stripe-sweep";
import { stripeWebhook } from "./stripe-webhook";

export { Enforcement } from "./enforcement";

const DASHBOARD_ORIGINS: readonly string[] = ["https://app.uwu.land"];

function corsOrigins(devOrigin: string | undefined): readonly string[] {
	const extra = devOrigin?.trim() ?? "";
	return extra === "" ? DASHBOARD_ORIGINS : [...DASHBOARD_ORIGINS, extra];
}

export type Env = Cloudflare.Env & {
	CLERK_WEBHOOK_SIGNING_SECRET?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	STRIPE_SECRET_KEY?: string;
	/**
	 * Extra browser origin allowed through CORS on /api/v1. Set to
	 * `http://localhost:3000` in services/api/.dev.vars; absent in production,
	 * which is what keeps the dev origin out of the deployed allowlist.
	 */
	CORS_DEV_ORIGIN?: string;
	/**
	 * Comma-separated allowlist for the `azp` claim on Clerk session tokens.
	 * Unset (the default) skips the check. See authorizedParties in auth.ts.
	 */
	CLERK_AUTHORIZED_PARTIES?: string;
};

export interface WorkerOptions {
	generateId?: IdGenerator;
	auth?: AuthOptions;
	createPerDayLimit?: number;
	stripeFetch?: typeof fetch;
	/** Test seam for the launch offer; production follows the shared constant. */
	launchOffer?: boolean;
}

export function createApp(options: WorkerOptions = {}): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();

	// The dashboard origin is the only one hardcoded. The dev origin comes from
	// CORS_DEV_ORIGIN, which lives in .dev.vars and is absent from
	// wrangler.jsonc, so http://localhost:3000 never reaches production.
	// Resolved per request because createApp() runs before env exists.
	app.use(
		"/api/v1/*",
		cors({
			origin: (origin, c) =>
				corsOrigins((c.env as Env).CORS_DEV_ORIGIN).includes(origin)
					? origin
					: null,
			allowMethods: ["GET", "POST", "OPTIONS", "DELETE"]
		})
	);

	app.post("/webhooks/clerk", (c) => clerkWebhook(c, options));
	app.post("/webhooks/stripe", (c) => stripeWebhook(c, options));
	app.get("/", (c) => c.redirect("https://app.uwu.land", 302));
	app.post("/api/v1/links", (c) => createLink(c, options));
	app.get("/api/v1/links", (c) => listLinks(c, options));
	app.get("/api/v1/links/:slug/stats", linkStats);
	app.get("/api/v1/links/:slug", (c) => getLink(c, options));
	app.delete("/api/v1/links/:slug", (c) => deleteLink(c, options));
	app.get("/api/v1/me", (c) => me(c, options));
	app.post("/api/v1/keys", (c) => createKey(c, options));
	app.get("/api/v1/keys", (c) => listKeys(c, options));
	app.delete("/api/v1/keys/:id", (c) => deleteKey(c, options));
	app.post("/api/v1/billing/checkout", (c) =>
		createBillingCheckout(c, options)
	);
	app.post("/api/v1/billing/portal", (c) => createBillingPortal(c, options));

	app.get("/favicon.ico", (c) => c.notFound());
	app.get("/robots.txt", (c) => c.notFound());
	app.get("/:slug", redirectSlug);

	return app;
}

export function createWorker(options: WorkerOptions = {}): ExportedHandler<Env> {
	const app = createApp(options);
	return {
		fetch: (request, env, ctx) => app.fetch(request, env, ctx),
		scheduled: (event, env, ctx) => {
			ctx.waitUntil(reconcilePendingLinks(env));
			ctx.waitUntil(materializeClickCounts(env));
			if (event.cron === "0 6 * * *") {
				ctx.waitUntil(syncBannedDomains(env));
				ctx.waitUntil(purgeExpiredAccountTombstones(env.DB));
				ctx.waitUntil(
					sweepDeletedUserSubscriptions(env, options.stripeFetch)
				);
			}
		}
	};
}

export default createWorker();
