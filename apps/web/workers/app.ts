import { createRequestHandler } from "react-router";
import { withSecurityHeaders } from "./security-headers";

type Env = Record<string, never>;

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE
);

export default {
	// Headers go on here rather than in entry.server.tsx: that entry only runs
	// for successful document SSR, so it would miss `.data` single-fetch
	// responses, loader/action redirects, Clerk's handshake redirects, and any
	// error response thrown before render. Everything the worker answers passes
	// through this one point.
	async fetch(request) {
		return withSecurityHeaders(await requestHandler(request));
	}
} satisfies ExportedHandler<Env>;
