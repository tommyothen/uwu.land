import { TIERS } from "@uwu/shared";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import type { Route } from "./+types/docs";

export const meta: Route.MetaFunction = () => [
	{ title: "API docs | uwu.land" },
	{
		name: "description",
		content:
			"Everything you need to shorten, list, and delete links with the uwu.land public API."
	}
];

const ENDPOINTS = [
	{
		method: "POST",
		path: "/links",
		auth: "Optional",
		notes: "Create a short link. Anonymous callers get random slugs only."
	},
	{
		method: "GET",
		path: "/links",
		auth: "Required",
		notes: "List your links, newest first, cursor paginated."
	},
	{
		method: "GET",
		path: "/links/:slug",
		auth: "Required (owner)",
		notes: "Fetch one of your links."
	},
	{
		method: "GET",
		path: "/links/:slug/stats",
		auth: "None",
		notes: "Public total click count."
	},
	{
		method: "DELETE",
		path: "/links/:slug",
		auth: "Required (owner)",
		notes: "Delete one of your links."
	},
	{
		method: "GET",
		path: "/me",
		auth: "Required",
		notes: "Your tier and limits."
	},
	{
		method: "POST",
		path: "/keys",
		auth: "Clerk session only",
		notes: "Create an API key (dashboard action)."
	},
	{
		method: "GET",
		path: "/keys",
		auth: "Clerk session only",
		notes: "List your keys."
	},
	{
		method: "DELETE",
		path: "/keys/:id",
		auth: "Clerk session only",
		notes: "Revoke a key."
	}
];

const ERROR_CODES = [
	["invalid_body", "Request body, URL, slug, or cursor failed validation."],
	["slug_taken", "The requested slug already exists."],
	["slug_reserved", "The requested slug is reserved (for example, api)."],
	["url_banned", "The destination hostname is banned."],
	["rate_limited", "You hit a rate limit for your tier."],
	["not_found", "The link or key does not exist."],
	["unauthorized", "Authentication is missing or invalid."],
	["forbidden", "You are authenticated but not allowed to do this."],
	["key_limit", "Your account reached its API key limit."]
];

function Code({ children }: { children: ReactNode }) {
	return (
		<pre className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-100 p-4 font-mono text-sm leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
			{children}
		</pre>
	);
}

function H2({ id, children }: { id: string; children: ReactNode }) {
	return (
		<h2
			id={id}
			className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight"
		>
			<a href={`#${id}`} className="hover:underline">
				{children}
			</a>
		</h2>
	);
}

export default function DocsPage() {
	return (
		<div className="min-h-[100dvh]">
			<SiteHeader />
			<main className="mx-auto w-full max-w-3xl px-6 pt-10 pb-20">
				<h1 className="text-3xl font-semibold tracking-tighter">
					uwu.land API
				</h1>
				<p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
					A small JSON API for shortening links. The dashboard runs on exactly
					this API; there are no private endpoints.
				</p>

				<H2 id="base-url">Base URL</H2>
				<Code>https://uwu.land/api/v1</Code>

				<H2 id="authentication">Authentication</H2>
				<p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
					Authenticated endpoints take a Bearer token. Create an API key in the
					dashboard and send it on every request:
				</p>
				<Code>Authorization: Bearer uwu_your_api_key</Code>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					Creating a link works without any authentication, rate limited per
					IP. Key management endpoints only accept a Clerk session token, so a
					leaked API key can never mint more keys.
				</p>

				<H2 id="endpoints">Endpoints</H2>
				<div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
								<th className="p-3 font-medium">Endpoint</th>
								<th className="p-3 font-medium">Auth</th>
								<th className="p-3 font-medium">Notes</th>
							</tr>
						</thead>
						<tbody>
							{ENDPOINTS.map((endpoint) => (
								<tr
									key={`${endpoint.method} ${endpoint.path}`}
									className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
								>
									<td className="whitespace-nowrap p-3 font-mono text-xs">
										{endpoint.method} {endpoint.path}
									</td>
									<td className="whitespace-nowrap p-3 text-zinc-600 dark:text-zinc-400">
										{endpoint.auth}
									</td>
									<td className="p-3 text-zinc-600 dark:text-zinc-400">
										{endpoint.notes}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<H2 id="create-a-link">Create a link</H2>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					Anonymous callers may only send <code>url</code>. With a key or
					session you can also pick a custom <code>slug</code> (3 to 16
					characters: letters, numbers, underscores, hyphens) and attach an{" "}
					<code>external_ref</code>.
				</p>
				<Code>{`curl -X POST https://uwu.land/api/v1/links \\
  -H "Authorization: Bearer uwu_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/some/long/path", "slug": "my-link"}'`}</Code>
				<p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
					201 response:
				</p>
				<Code>{`{
  "slug": "my-link",
  "short_url": "https://uwu.land/my-link",
  "url": "https://example.com/some/long/path"
}`}</Code>

				<H2 id="list-links">List your links</H2>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					Newest first, 25 per page. When more pages exist the response
					includes a <code>cursor</code>; pass it back as{" "}
					<code>?cursor=</code>. Filter with <code>?external_ref=</code>.
				</p>
				<Code>{`{
  "links": [
    {
      "slug": "my-link",
      "short_url": "https://uwu.land/my-link",
      "url": "https://example.com/some/long/path",
      "clicks": 42,
      "external_ref": "discord:81384788765712384",
      "created_at": "2026-07-10T12:00:00.000Z"
    }
  ],
  "cursor": "eyJjcmVhdGVkX2F0IjoiLi4uIn0"
}`}</Code>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					<code>GET /links/:slug</code> returns a single object in the same
					shape. <code>DELETE /links/:slug</code> returns 204 with no body.
				</p>

				<H2 id="stats">Public stats</H2>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					Total clicks for any slug are public and need no authentication.
				</p>
				<Code>{`GET /api/v1/links/my-link/stats

{ "slug": "my-link", "clicks": 42 }`}</Code>

				<H2 id="me">Your account</H2>
				<Code>{`GET /api/v1/me

{
  "user_id": "user_2abc...",
  "tier": "free",
  "limits": { "createPerDay": ${TIERS.free.createPerDay}, "apiPerMin": ${TIERS.free.apiPerMin}, "apiKeys": ${TIERS.free.apiKeys} }
}`}</Code>

				<H2 id="keys">API keys</H2>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					Key endpoints require a Clerk session, so use the dashboard. The
					secret is returned exactly once at creation:
				</p>
				<Code>{`POST /api/v1/keys
{ "name": "my-discord-bot" }

201:
{
  "id": "9f4c2f8a-...",
  "name": "my-discord-bot",
  "secret": "uwu_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6",
  "display_prefix": "uwu_a1B2c3D4"
}`}</Code>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					<code>GET /keys</code> lists your keys without secrets.{" "}
					<code>DELETE /keys/:id</code> revokes one and returns 204.
				</p>

				<H2 id="external-ref">external_ref: act on behalf of your users</H2>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					If your integration creates links for many end users under one key,
					tag each link with an opaque <code>external_ref</code> (up to 64
					characters) and filter by it later. A Discord bot, for example, tags
					links with <code>discord:&lt;userId&gt;</code>, then lists or deletes
					a single user's links with{" "}
					<code>GET /links?external_ref=discord:81384788765712384</code>. Refs
					are scoped to your account, so other keys and users never see them.
				</p>

				<H2 id="errors">Errors</H2>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					All errors share one envelope with a stable <code>code</code>:
				</p>
				<Code>{`{ "status": 409, "code": "slug_taken", "message": "Slug is already taken." }`}</Code>
				<div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
								<th className="p-3 font-medium">Code</th>
								<th className="p-3 font-medium">Meaning</th>
							</tr>
						</thead>
						<tbody>
							{ERROR_CODES.map(([code, meaning]) => (
								<tr
									key={code}
									className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
								>
									<td className="whitespace-nowrap p-3 font-mono text-xs">
										{code}
									</td>
									<td className="p-3 text-zinc-600 dark:text-zinc-400">
										{meaning}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<H2 id="rate-limits">Rate limits</H2>
				<div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
								<th className="p-3 font-medium">Tier</th>
								<th className="p-3 font-medium">Links per day</th>
								<th className="p-3 font-medium">API requests per minute</th>
								<th className="p-3 font-medium">API keys</th>
							</tr>
						</thead>
						<tbody>
							{(["anon", "free", "pro"] as const).map((tier) => (
								<tr
									key={tier}
									className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
								>
									<td className="p-3 capitalize">
										{tier === "anon" ? "Anonymous" : tier}
									</td>
									<td className="p-3 tabular-nums">
										{TIERS[tier].createPerDay}
									</td>
									<td className="p-3 tabular-nums">{TIERS[tier].apiPerMin}</td>
									<td className="p-3 tabular-nums">
										{TIERS[tier].apiKeys === 0 ? "None" : TIERS[tier].apiKeys}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
					Anonymous limits apply per IP; account limits apply per key. Hitting
					a limit returns 429 with code <code>rate_limited</code>.
				</p>
			</main>
		</div>
	);
}
