# uwu.land

uwu.land is a tiny URL shortener growing into a small public API product with anonymous shortening, account-managed links, API keys, and tiered abuse protection.

uwu.land is free forever, and will always be free with no ads or account creation required.

## Repo layout

| Path | Purpose |
| --- | --- |
| `services/api` | Cloudflare Worker for redirects and `/api/v1`. |
| `apps/web` | React Router v7 landing + dashboard app for app.uwu.land (Cloudflare Workers). |
| `packages/shared` | Shared API contract types and tier config. |
| `packages/db` | Drizzle schema and D1 migrations. |
| `docs` | Maintenance and operations notes. |

## Web app

`apps/web` is the React Router v7 framework-mode app for app.uwu.land: landing page with
anonymous shortening, Clerk-authenticated dashboard (links, API keys, account),
direct Stripe Billing for First-Class subscriptions, and the public API docs at
`/docs`. It is an ordinary consumer of `/api/v1`, calling it client-side with
Clerk session JWTs. Clerk remains the auth provider; Stripe Checkout, Billing
Portal, and subscription webhooks handle billing.

The visual system is "Riso Post Office" (riso-print postal metaphor).
Type stack: Bricolage Grotesque (display/wordmark), Instrument Sans (body/UI),
Space Mono (postal jobs and short-link slugs), all self-hosted via Fontsource.

Local dev (Vite reads `.env.local`; `.dev.vars` is not used by the web app):

```sh
# apps/web/.env.local — fill in your Clerk app's keys:
#   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
#   CLERK_SECRET_KEY=sk_test_...
#   VITE_UWU_API_URL=http://localhost:8787   # local worker; omit for prod

# terminal 1 — the API worker (local KV/D1 simulation):
cd services/api
pnpm exec wrangler d1 migrations apply uwu-land --local   # first run only
pnpm exec wrangler dev --port 8787

# terminal 2 — the web app:
pnpm --filter @uwu/web dev
```

The worker verifies dashboard JWTs against `CLERK_ISSUER`: for local dev put
`CLERK_ISSUER=https://<your-subdomain>.clerk.accounts.dev` (your Clerk app's
Frontend API URL) in `services/api/.dev.vars` — wrangler DOES read `.dev.vars`;
the Vite app is the odd one out.

Build and deploy (Cloudflare Workers via React Router and the Cloudflare Vite plugin):

```sh
pnpm --filter @uwu/web build         # React Router production build in build/
pnpm --filter @uwu/web deploy        # plain wrangler deploy
```

Env vars: `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`VITE_UWU_API_URL` (defaults to `https://uwu.land` when unset).

## API

The public JSON API is versioned under `/api/v1`. Authenticated endpoints accept `Authorization: Bearer ...` with either an uwu.land API key or a Clerk session JWT.

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `POST /api/v1/links` | Optional | Create a short link. Anonymous requests get random slugs only. Authenticated requests may use custom `slug` and `external_ref`. |
| `GET /api/v1/links` | Required | List owned links newest-first, cursor paginated, with optional `?external_ref=` filtering and materialized total clicks. Clicks are eventually consistent and refresh in bounded batches on the five-minute maintenance schedule. |
| `GET /api/v1/links/:slug` | Required, owner | Fetch owned link detail. Its click total has the same eventual freshness as the list endpoint. |
| `GET /api/v1/links/:slug/stats` | None | Public total click count for a slug. |
| `DELETE /api/v1/links/:slug` | Required, owner | Delete an owned D1 row and its KV redirect/click keys. Anonymous links cannot be deleted via API. |
| `GET /api/v1/me` | Required | Return user id, tier, and limits. |
| `POST /api/v1/keys` | Clerk session only | Create an API key. The secret is shown once in the response. |
| `GET /api/v1/keys` | Clerk session only | List non-revoked API keys without hashes or secrets. |
| `DELETE /api/v1/keys/:id` | Clerk session only | Revoke an API key. API keys cannot manage keys. |
| `POST /api/v1/billing/checkout` | Clerk session only | Create a Stripe Checkout Session for a monthly or yearly First-Class subscription. |
| `POST /api/v1/billing/portal` | Clerk session only | Create a Stripe Billing Portal Session for subscription management. |

### Errors

Error responses use a stable JSON envelope:

```json
{ "status": 400, "code": "invalid_body", "message": "Invalid request body." }
```

Stable `ErrorCode` values:

| Code | Meaning |
| --- | --- |
| `invalid_body` | Request body, URL, slug, or cursor validation failed. |
| `slug_taken` | Requested slug already exists in D1 or pre-v2 KV. |
| `slug_reserved` | Requested slug is reserved, such as `api`. |
| `url_banned` | Destination hostname is banned. |
| `rate_limited` | Tier or anonymous rate limit exceeded. |
| `not_found` | Requested link or API key does not exist. |
| `unauthorized` | Authentication is missing or invalid. |
| `forbidden` | Authenticated caller cannot perform this action. |
| `key_limit` | Account has reached its non-revoked API key limit. |
| `already_subscribed` | Account is already First-Class and cannot start another checkout. |
| `billing_unavailable` | Stripe could not create the requested billing session. |

## Maintenance

Run these from `services/api`; they operate on remote production infrastructure.

- `pnpm ban example.com` — block a destination domain and its subdomains.
- `pnpm unban example.com` — remove a domain block.
- `pnpm banned` — list blocked domains.
- `pnpm abuse:top -- --days 14` — report destination hosts with the most links in the last N days (default 7).
- `pnpm purge:domain example.com` — dry-run deletion of links for a domain and subdomains; add `--yes` to delete their D1 rows and UWU/CLICKS KV keys.

## Decisions

| Date | Decision | Notes |
| --- | --- | --- |
| 2026-07-10 | Restructure as a turborepo | Use pnpm workspaces, Turborepo, Biome, and TypeScript-source internal packages. |
| 2026-07-10 | Use Hono for the API Worker | Keep routing small and explicit for Cloudflare Workers. |
| 2026-07-10 | Use `@cloudflare/vitest-pool-workers` | Exercise KV and Worker behavior inside workerd-backed tests. |
| 2026-07-10 | Keep KV as the redirect hot path | D1 becomes the metadata plane; redirects stay KV-only. |
| 2026-07-10 | Anon-lane URL dedup + normalization; anon creates recorded in D1; maintainer ban/abuse CLI scripts | Normalized-URL KV reverse index dedupes anonymous creates only; D1 rows power abuse reporting; blocking stays KV `banned:<domain>` managed via pnpm scripts. |
| 2026-07-10 | Verify Clerk JWTs in-worker | Use `@clerk/backend` JWT verification with configured issuer and JWKS, without Clerk network calls in tests. |
| 2026-07-10 | Landing redesign: "Riso Post Office" visual system | Riso grain + postal metaphor on the 2021 brand; Bricolage/Instrument/Space Mono; one GSAP submit choreography; shadcn tokens. |
| 2026-07-10 | apps/web on React Router v7 + @cloudflare/vite-plugin (replacing Next/OpenNext) | app used no Next-specific features; drop the adapter layer and its operational risk (build fork-bomb class bugs, env split-brain). |
| 2026-07-13 | Billing: Clerk Billing → direct Stripe Billing (Checkout + Billing Portal + webhooks) | PayPal + 3DS support; Clerk checkout renders neither. Clerk remains auth-only. |

## License

uwu.land is licensed under the MIT License. See [LICENSE](LICENSE) for more information.
