import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AuthOptions } from "./auth";
import {
	createKey,
	deleteKey,
	listKeys
} from "./keys-routes";
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

export interface Env {
	UWU: KVNamespace;
	CLICKS: KVNamespace;
	CLICK_EVENTS: AnalyticsEngineDataset;
	DB: D1Database;
	CLERK_ISSUER?: string;
}

export interface WorkerOptions {
	generateId?: IdGenerator;
	auth?: AuthOptions;
}

export function createApp(options: WorkerOptions = {}): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();

	app.use(
		"/api/v1/*",
		cors({
			origin: "https://app.uwu.land",
			allowMethods: ["GET", "POST", "OPTIONS", "DELETE"]
		})
	);

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

	app.get("/favicon.ico", (c) => c.notFound());
	app.get("/robots.txt", (c) => c.notFound());
	app.get("/:slug", redirectSlug);

	return app;
}

export function createWorker(options: WorkerOptions = {}): ExportedHandler<Env> {
	const app = createApp(options);
	return {
		fetch: (request, env, ctx) => app.fetch(request, env, ctx)
	};
}

export default createWorker();
