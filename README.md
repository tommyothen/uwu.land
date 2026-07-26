# uwu.land

A URL shortener with a public JSON API, running entirely on Cloudflare Workers.
[uwu.land](https://uwu.land) serves the redirects and the API,
[app.uwu.land](https://app.uwu.land) serves the landing page and the dashboard.

uwu.land is free forever, and will always be free with no ads or account
creation required. The free limits are generous, and if you need more than they
allow, First-Class is cheap.

| Tier | Links per day | API keys | Price |
| --- | --- | --- | --- |
| Anonymous | 20 | 0 | free |
| Free account | 250 | 2 | free |
| First-Class | 10,000 | 10 | $4/month, or $40 once |

Those are the sticker prices; a launch discount is running at the moment, so
[app.uwu.land](https://app.uwu.land) is where the current ones are. The
authoritative limits are in `packages/shared/src/tiers.ts`, which both workers
read. The table above is a copy, so trust the file if they disagree.

## Stack

Cloudflare Workers throughout, with D1 for link records, KV for the redirect hot
path, and Durable Objects for rate limiting. The web app is React Router v7 in
framework mode. Clerk handles auth and Stripe handles billing.

The visual system is "Riso Post Office", a riso-print postal metaphor. Bricolage
Grotesque sets display text and the wordmark, Instrument Sans the body and UI,
and Space Mono the postal jobs and short-link slugs, all self-hosted via
Fontsource.

## Quickstart

You need Node 22+, pnpm 11, and a Cloudflare account for the local wrangler
simulation. Anything behind sign-in also needs your own Clerk dev instance.

```sh
pnpm install

# One-time: create the local D1 database.
pnpm --filter uwu-land-api exec wrangler d1 migrations apply uwu-land --local

# Both workers, watched, on :8787 (API) and :3000 (web).
pnpm dev
```

Two env files, and they are not interchangeable. Vite reads `apps/web/.env.local`
and ignores `.dev.vars`; wrangler reads `services/api/.dev.vars`. The web app is
the odd one out.

```sh
# apps/web/.env.local
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
VITE_UWU_API_URL=http://localhost:8787   # omit to point at production

# services/api/.dev.vars
CLERK_ISSUER=https://<your-subdomain>.clerk.accounts.dev   # Clerk's Frontend API URL
CORS_DEV_ORIGIN=http://localhost:3000
```

`CORS_DEV_ORIGIN` is deliberately absent from `wrangler.jsonc` so it can never
ship. Production allows `https://app.uwu.land` and nothing else. Forget it
locally and the dashboard's API calls fail CORS while production stays fine,
which is also why `apps/web/vite.config.ts` pins port 3000 with `strictPort`.

Other useful commands, all Turbo tasks from the repo root:

```sh
pnpm test          # vitest across every package
pnpm lint          # biome
pnpm check-types   # tsc, plus react-router typegen for the web app
```

## Repo layout

| Path | Purpose |
| --- | --- |
| `services/api` | Cloudflare Worker for redirects and `/api/v1`. |
| `apps/web` | React Router v7 landing page and dashboard for app.uwu.land. |
| `packages/shared` | Shared API contract types and tier config. |
| `packages/db` | Drizzle schema and D1 migrations. |
| `docs` | Deployment, operations, and the decision log. |

## API

The public JSON API is versioned under `/api/v1`. Creating a link works
unauthenticated; everything else takes `Authorization: Bearer ...` with either an
uwu.land API key or a Clerk session JWT.

```sh
curl -X POST https://uwu.land/api/v1/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

Full endpoint reference, error codes, and the response envelope are documented at
[app.uwu.land/docs](https://app.uwu.land/docs). The contract types the worker
validates against are in `packages/shared`.

## Docs

- [docs/MAINTENANCE.md](docs/MAINTENANCE.md) is the day-2 runbook, covering abuse
  handling, billing operations, and the risks knowingly left open.
- [docs/decisions.md](docs/decisions.md) records the architecture and product
  decisions along with the alternatives that lost.

## Self-hosting and contributions

The source is MIT, but running your own copy is not a path this repo supports.
It assumes Cloudflare, Clerk, and Stripe accounts, and the config carries live
resource IDs for mine. You are welcome to read it and take whatever is useful.

Issues and pull requests are welcome, though this is a personal project and I
make no promises about response times.

## License

MIT. See [LICENSE](LICENSE).
