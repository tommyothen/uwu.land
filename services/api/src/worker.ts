import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AuthOptions } from "./auth";
import { syncBannedDomains } from "./ban-sync";
import {
	createBillingCheckout,
	createBillingPortal
} from "./billing-routes";
import { clerkWebhook } from "./clerk-webhook";
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
import { stripeWebhook } from "./stripe-webhook";

export { Enforcement } from "./enforcement";

export type Env = Cloudflare.Env & {
	CLERK_WEBHOOK_SIGNING_SECRET?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	STRIPE_SECRET_KEY?: string;
};

export interface WorkerOptions {
	generateId?: IdGenerator;
	auth?: AuthOptions;
	createPerDayLimit?: number;
	stripeFetch?: typeof fetch;
}

export function createApp(options: WorkerOptions = {}): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();

	app.use(
		"/api/v1/*",
		cors({
			origin: ["https://app.uwu.land", "http://localhost:3000"],
			allowMethods: ["GET", "POST", "OPTIONS", "DELETE"]
		})
	);

	app.post("/webhooks/clerk", (c) => clerkWebhook(c, options));
	app.post("/webhooks/stripe", stripeWebhook);
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
			if (event.cron === "0 6 * * *") ctx.waitUntil(syncBannedDomains(env));
		}
	};
}

export default createWorker();
