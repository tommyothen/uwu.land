# uwu.land

uwu.land is a tiny URL shortener growing into a small public API product with anonymous shortening, account-managed links, API keys, and tiered abuse protection.

uwu.land is free forever, and will always be free with no ads or account creation required.

## Repo layout

| Path | Purpose |
| --- | --- |
| `services/api` | Cloudflare Worker for redirects and `/api/v1`. |
| `apps/web` | Next.js landing + dashboard app for app.uwu.land (OpenNext on Cloudflare). |
| `packages/shared` | Shared API contract types and tier config. |
| `packages/db` | Drizzle schema and D1 migrations. |
| `docs` | Product specs and implementation plans. |

## Web app

`apps/web` is the Next.js App Router app for app.uwu.land: landing page with
anonymous shortening, Clerk-authenticated dashboard (links, API keys, account),
and the public API docs at `/docs`. It is an ordinary consumer of `/api/v1`,
calling it client-side with Clerk session JWTs.

Local dev:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars  # then fill in real Clerk keys
pnpm --filter @uwu/web dev
```

Build and deploy (Cloudflare Workers via OpenNext):

```sh
pnpm --filter @uwu/web build         # next build (per-commit verification)
pnpm --filter @uwu/web build:worker  # OpenNext worker bundle in .open-next/
pnpm --filter @uwu/web deploy        # wrangler deploy of the bundle
```

Env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`NEXT_PUBLIC_UWU_API_URL` (defaults to `https://uwu.land` when unset).

## API

The public JSON API is versioned under `/api/v1`. Authenticated endpoints accept `Authorization: Bearer ...` with either an uwu.land API key or a Clerk session JWT.

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `POST /api/v1/links` | Optional | Create a short link. Anonymous requests get random slugs only. Authenticated requests may use custom `slug` and `external_ref`. |
| `GET /api/v1/links` | Required | List owned links newest-first, cursor paginated, with optional `?external_ref=` filtering and total clicks. |
| `GET /api/v1/links/:slug` | Required, owner | Fetch owned link detail. |
| `GET /api/v1/links/:slug/stats` | None | Public total click count for a slug. |
| `DELETE /api/v1/links/:slug` | Required, owner | Delete an owned D1 row and its KV redirect/click keys. Anonymous links cannot be deleted via API. |
| `GET /api/v1/me` | Required | Return user id, tier, and limits. |
| `POST /api/v1/keys` | Clerk session only | Create an API key. The secret is shown once in the response. |
| `GET /api/v1/keys` | Clerk session only | List non-revoked API keys without hashes or secrets. |
| `DELETE /api/v1/keys/:id` | Clerk session only | Revoke an API key. API keys cannot manage keys. |

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

## Decisions

| Date | Decision | Notes |
| --- | --- | --- |
| 2026-07-10 | Restructure as a turborepo | Use pnpm workspaces, Turborepo, Biome, and TypeScript-source internal packages. |
| 2026-07-10 | Use Hono for the API Worker | Keep routing small and explicit for Cloudflare Workers. |
| 2026-07-10 | Use `@cloudflare/vitest-pool-workers` | Exercise KV and Worker behavior inside workerd-backed tests. |
| 2026-07-10 | Keep KV as the redirect hot path | D1 becomes the metadata plane; redirects stay KV-only. |
| 2026-07-10 | Verify Clerk JWTs in-worker | Use `@clerk/backend` JWT verification with configured issuer and JWKS, without Clerk network calls in tests. |
| 2026-07-10 | apps/web = Next.js App Router on Cloudflare Workers via @opennextjs/cloudflare | Clerk components for auth UI; dashboard calls the public /api/v1 with Clerk JWTs (no private endpoints). |

## License

uwu.land is licensed under the MIT License. See [LICENSE](LICENSE) for more information.
