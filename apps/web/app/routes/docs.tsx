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

const ERROR_CODES: readonly [status: string, code: string, when: ReactNode][] = [
	["400", "invalid_body", "Malformed JSON, URL, slug, or cursor."],
	["400", "slug_reserved", "The requested slug is reserved (for example, api)."],
	["400", "url_banned", "The destination is blocked by moderation."],
	["401", "unauthorized", "Auth is missing, invalid, or revoked."],
	[
		"403",
		"forbidden",
		<>
			The request is understood but not permitted: an anonymous caller sent a
			restricted field, you are not the link owner, or an API key called a{" "}
			<code>/keys</code> endpoint.
		</>
	],
	["404", "not_found", "The link or key does not exist."],
	["409", "slug_taken", "The requested slug already exists."],
	["409", "key_limit", "Your account reached its API key limit."],
	["429", "rate_limited", "You exceeded your daily link-creation quota."]
];

function Code({ children }: { children: ReactNode }) {
	return (
		<pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-secondary p-4 font-mono text-sm leading-relaxed text-foreground">
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
				<p className="mt-3 leading-relaxed text-muted-foreground">
					A small JSON API for shortening links. The dashboard runs on exactly
					this API; there are no private endpoints.
				</p>

				<H2 id="base-url">Base URL</H2>
				<Code>https://uwu.land/api/v1</Code>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Shorten a link in one call, no account required:
				</p>
				<Code>{`curl -X POST https://uwu.land/api/v1/links \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/some/long/path"}'`}</Code>

				<H2 id="authentication">Authentication</H2>
				<p className="mt-3 leading-relaxed text-muted-foreground">
					Every authenticated request uses{" "}
					<code>Authorization: Bearer &lt;token&gt;</code>. The token is either
					an API key (it starts with <code>uwu_</code>) or a Clerk session token
					that the dashboard sends automatically. Cookies are never read.
				</p>
				<p className="mt-3 leading-relaxed text-muted-foreground">
					API keys act as their owning account: links created with any of the
					account&apos;s keys or the dashboard belong to the same account and appear
					in the same list.
				</p>
				<Code>Authorization: Bearer uwu_your_api_key</Code>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					<code>/links</code> and <code>/me</code> accept either token type,
					and <code>POST /links</code> also works with no token at all. The{" "}
					<code>/keys</code> endpoints accept only a Clerk session; an API key
					gets 403 there, so a leaked key can never mint more keys.
				</p>

				<H2 id="endpoints">Endpoints</H2>
				<div className="mt-3 overflow-x-auto rounded-xl border border-border">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-border bg-secondary text-muted-foreground">
								<th className="p-3 font-medium">Endpoint</th>
								<th className="p-3 font-medium">Auth</th>
								<th className="p-3 font-medium">Notes</th>
							</tr>
						</thead>
						<tbody>
							{ENDPOINTS.map((endpoint) => (
								<tr
									key={`${endpoint.method} ${endpoint.path}`}
									className="border-b border-border last:border-b-0"
								>
									<td className="whitespace-nowrap p-3 font-mono text-xs">
										{endpoint.method} {endpoint.path}
									</td>
									<td className="whitespace-nowrap p-3 text-muted-foreground">
										{endpoint.auth}
									</td>
									<td className="p-3 text-muted-foreground">
										{endpoint.notes}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<H2 id="link-object">The link object</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Every endpoint that returns a link, whether a list item or a single{" "}
					<code>GET</code>, uses this shape:
				</p>
				<Code>{`{
  "slug": "my-link",
  "short_url": "https://uwu.land/my-link",
  "url": "https://example.com/some/long/path",
  "clicks": 42,
  "created_at": "2026-07-10T12:00:00.000Z",
  "external_ref": "discord:214836288048594944"
}`}</Code>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					<code>short_url</code> is the canonical link. <code>clicks</code> is an
					integer. <code>created_at</code> is a UTC ISO 8601 timestamp.{" "}
					<code>external_ref</code> is omitted entirely when absent, never{" "}
					<code>null</code>.
				</p>

				<H2 id="create-a-link">Create a link</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Anonymous callers may only send <code>url</code>; sending{" "}
					<code>slug</code> or <code>external_ref</code> returns 403{" "}
					<code>forbidden</code>. With a key or session you can also pick a
					custom slug and attach an <code>external_ref</code>.
				</p>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					The <code>url</code> must be <code>http</code> or <code>https</code>, at
					most 2048 characters,
					carry no embedded credentials (<code>user:pass@</code>), and not point
					at uwu.land or any of its subdomains, so you cannot nest or loop short
					links. Rejected URLs return 400 <code>invalid_body</code>; banned
					destinations return 400 <code>url_banned</code>.
				</p>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					A custom <code>slug</code> is 3 to 16 characters of letters, numbers,
					underscores, and hyphens (ASCII only). Slugs are case-sensitive and
					stored exactly as sent, so <code>/Tommy</code> and <code>/tommy</code>{" "}
					are different links. A few names such as <code>api</code> are reserved
					(matched case-insensitively).
				</p>
				<Code>{`curl -X POST https://uwu.land/api/v1/links \\
  -H "Authorization: Bearer uwu_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/some/long/path", "slug": "my-link"}'`}</Code>
				<p className="mt-3 text-sm text-muted-foreground">
					The same call from JavaScript, reading the error envelope on failure:
				</p>
				<Code>{`const res = await fetch("https://uwu.land/api/v1/links", {
  method: "POST",
  headers: {
    Authorization: "Bearer uwu_your_api_key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ url: "https://example.com/some/long/path", slug: "my-link" })
});

const data = await res.json();
if (!res.ok) {
  throw new Error(\`\${data.code}: \${data.message}\`);
}
console.log(data.short_url);`}</Code>
				<p className="mt-3 text-sm text-muted-foreground">
					A 201 returns the new link object.
				</p>

				<H2 id="list-links">List your links</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Results come newest first, 25 per page, and are cursor paginated. Omit{" "}
					<code>cursor</code> for the first page. When more pages exist the response includes a{" "}
					<code>cursor</code>; pass it back as <code>?cursor=</code>. The last
					page omits the <code>cursor</code> field. A malformed cursor returns
					400 <code>invalid_body</code>.
				</p>
				<Code>{`{
  "links": [
    {
      "slug": "my-link",
      "short_url": "https://uwu.land/my-link",
      "url": "https://example.com/some/long/path",
      "clicks": 42,
      "external_ref": "discord:214836288048594944",
      "created_at": "2026-07-10T12:00:00.000Z"
    }
  ],
  "cursor": "eyJjcmVhdGVkX2F0IjoiLi4uIn0"
}`}</Code>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Filter with <code>?external_ref=</code>. The filter is not baked into
					the cursor, so repeat it on every page request.{" "}
					<code>GET /links/:slug</code> returns a single link object.{" "}
					<code>DELETE /links/:slug</code> returns 204 with no body.
				</p>

				<H2 id="redirects">Redirects &amp; clicks</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Short links redirect with HTTP <code>302</code>. Every successful redirect counts
					one click, including bots and link-preview crawlers, so a link often
					has a few clicks before anyone opens it. Counting happens in the
					background, so totals are eventually consistent and may lag a few
					seconds. Query params on the short URL are not merged into the
					destination; the stored URL is used unchanged. Unknown slugs redirect
					(<code>302</code>) to the 404 page.
				</p>

				<H2 id="stats">Public stats</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Total clicks for any slug are public and need no authentication.
				</p>
				<Code>{`GET /api/v1/links/my-link/stats

{ "slug": "my-link", "clicks": 42 }`}</Code>

				<H2 id="external-ref"><code>external_ref</code>: tag links per user</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					<code>external_ref</code> is an opaque metadata tag (up to 64
					characters) you attach to a link, not an isolation boundary. It does
					not scope visibility. The account sees and controls every link created
					through its dashboard session or any of its API keys, regardless of{" "}
					<code>external_ref</code>. A Discord bot, for example, tags links
					with <code>discord:&lt;userId&gt;</code>, then lists one user's links
					with <code>GET /links?external_ref=discord:214836288048594944</code>.
				</p>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Because the ref is not enforced, before acting for an end user,
					especially on deletes, fetch the link and confirm its{" "}
					<code>external_ref</code> matches that user. Possession of a slug
					proves nothing.
				</p>

				<H2 id="errors">Errors</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Success statuses are 201 for <code>POST /links</code>, 200 for GETs,
					and 204 for DELETEs. All errors share one envelope with a stable{" "}
					<code>code</code>:
				</p>
				<Code>{`{ "status": 409, "code": "slug_taken", "message": "Slug is already taken." }`}</Code>
				<div className="mt-3 overflow-x-auto rounded-xl border border-border">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-border bg-secondary text-muted-foreground">
								<th className="p-3 font-medium">Status</th>
								<th className="p-3 font-medium">Code</th>
								<th className="p-3 font-medium">When</th>
							</tr>
						</thead>
						<tbody>
							{ERROR_CODES.map(([status, code, when]) => (
								<tr
									key={code}
									className="border-b border-border last:border-b-0"
								>
									<td className="whitespace-nowrap p-3 tabular-nums">
										{status}
									</td>
									<td className="whitespace-nowrap p-3 font-mono text-xs">
										{code}
									</td>
									<td className="p-3 text-muted-foreground">{when}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<H2 id="rate-limits">Rate limits</H2>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Link-creation quotas are per day. Anonymous callers are limited per
					IP; authenticated callers are limited per account, shared across every
					API key and the dashboard.
				</p>
				<div className="mt-3 overflow-x-auto rounded-xl border border-border">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-border bg-secondary text-muted-foreground">
								<th className="p-3 font-medium">Tier</th>
								<th className="p-3 font-medium">Links per day</th>
								<th className="p-3 font-medium">API keys</th>
							</tr>
						</thead>
						<tbody>
							{(["anon", "free", "pro"] as const).map((tier) => (
								<tr
									key={tier}
									className="border-b border-border last:border-b-0"
								>
									<td className="p-3">
										{TIERS[tier].displayName}
									</td>
									<td className="p-3 tabular-nums">
										{TIERS[tier].createPerDay}
									</td>
									<td className="p-3 tabular-nums">
										{TIERS[tier].apiKeys === 0 ? "None" : TIERS[tier].apiKeys}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Exceeding the quota returns 429 with code <code>rate_limited</code>. A
					429 includes <code>retry_after</code> (integer seconds) in the error
					body and a matching <code>Retry-After</code> header.
				</p>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					First-Class (the <code>pro</code> tier) costs $4/month or $36/year;
					Free and anonymous use stay free forever. Subscriptions are purchased
					and managed from the account dashboard through Stripe Checkout and the
					Stripe Billing Portal.
				</p>

				<H2 id="me">Your account</H2>
				<Code>{`GET /api/v1/me

{
  "user_id": "user_2abc...",
  "tier": "free",
  "limits": { "createPerDay": ${TIERS.free.createPerDay}, "apiKeys": ${TIERS.free.apiKeys}, "displayName": "${TIERS.free.displayName}" },
  "usage": { "createdToday": 14, "apiKeys": 1, "resetAt": "2026-07-11T09:30:00.000Z" }
}`}</Code>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					<code>limits</code> are the static values for your tier;{" "}
					<code>usage</code> shows what you have consumed: <code>createdToday</code>{" "}
					counts link creations in the current daily window and <code>resetAt</code>{" "}
					(UTC ISO 8601, <code>null</code> before your first create of the window){" "}
					is when it resets.
				</p>

				<H2 id="keys">Key management</H2>
				<div className="mt-3 rounded-xl border border-border bg-secondary p-4">
					<p className="text-xs font-semibold uppercase tracking-wide text-foreground">
						Dashboard-only endpoints
					</p>
					<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
						The <code>/keys</code> endpoints authenticate with a Clerk session,
						which the dashboard sends for you. An API key gets 403 here, so you
						manage keys in the dashboard rather than by hand.
					</p>
				</div>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Secrets are stored only as one-way hashes and shown exactly once at
					creation. <code>display_prefix</code> contains the first 12 characters
					and is safe to use when identifying a key.
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
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					<code>GET /keys</code> lists your keys without secrets.{" "}
					<code>DELETE /keys/:id</code> revokes one and returns 204; a revoked
					key is rejected immediately with 401 <code>unauthorized</code>.
				</p>
			</main>
		</div>
	);
}
