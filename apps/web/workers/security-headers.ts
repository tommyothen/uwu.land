/**
 * Baseline security headers for every response the web worker serves.
 *
 * Deliberately NOT a content CSP. Sign-in loads Clerk from
 * `*.clerk.accounts.dev` / `clerk.uwu.land`, and a `script-src` or
 * `connect-src` that misses one of those origins breaks auth silently, in a
 * way no test in this repo would catch. `frame-ancestors` is safe to ship
 * alone: it has no `default-src` fallback, so a frame-only CSP cannot affect
 * script, style, or fetch loading.
 *
 * Nothing under app.uwu.land is ever meant to be framed — there is no
 * `<iframe>` anywhere in `app/`, Clerk's `<SignIn>` / `<SignUp>` render inline,
 * and Stripe Checkout and the Billing Portal are top-level redirects. So the
 * frame policy is `DENY` / `'none'` rather than `'self'`.
 *
 * Not set here: `Strict-Transport-Security`. HSTS is a zone-wide commitment and
 * belongs at the Cloudflare edge, not in one worker that only answers for
 * app.uwu.land.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	// XFO for browsers that still honour it, frame-ancestors for the rest.
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin"
};

/**
 * Returns a copy of `response` carrying the baseline headers.
 *
 * Copies rather than mutates because responses built by `Response.redirect()`
 * — which is how loaders bounce a signed-out visitor off /dashboard, and how
 * Clerk finishes its handshake — have immutable headers that `.set()` throws
 * on. The `new Response(body, init)` form passes the original through as the
 * init, preserving status, statusText, and every other header, and keeps the
 * body a stream so SSR still streams.
 *
 * The baseline overwrites rather than defers to whatever a route set, so the
 * guarantee holds unconditionally and no route can quietly downgrade it.
 */
export function withSecurityHeaders(response: Response): Response {
	const secured = new Response(response.body, response);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		secured.headers.set(name, value);
	}
	return secured;
}
