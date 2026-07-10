import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAnonymousLink, linkStats } from "./links";
import { redirectSlug } from "./redirect";
import type { IdGenerator } from "./slugs";

export interface Env {
	UWU: KVNamespace;
	CLICKS: KVNamespace;
	CLICK_EVENTS: AnalyticsEngineDataset;
}

export interface WorkerOptions {
	generateId?: IdGenerator;
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
	app.post("/api/v1/links", (c) => createAnonymousLink(c, options));
	app.get("/api/v1/links/:slug/stats", linkStats);

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
