# uwu.land

A URL shortener with a public JSON API, running entirely on Cloudflare Workers.
[uwu.land](https://uwu.land) serves redirects and the API;
[app.uwu.land](https://app.uwu.land) serves the landing page, dashboard, and API
docs.

uwu.land is free forever, with no ads and no account required. The free limits
are generous, and First-Class is cheap if you need more.

## Tiers and limits

| Tier | Links per day | API keys | Price |
| --- | --- | --- | --- |
| Anonymous | 20 | 0 | Free |
| Free account | 250 | 2 | Free |
| First-Class | 10,000 | 10 | $4/month, or $40 once |

Those are the standard prices. A launch discount is running at the moment, so
check [app.uwu.land](https://app.uwu.land) for current pricing. The source of
truth for limits and pricing is
[packages/shared/src/tiers.ts](packages/shared/src/tiers.ts), which both workers
read. If this table and that file disagree, trust the file.

Anonymous links have a few extra limits:

- Keyless API calls without a Turnstile token get 3 links a day per IP, counted
  towards the 20-link daily cap. Creating on [app.uwu.land](https://app.uwu.land)
  gets the full 20, or use a free API key for more.
- New anonymous links are capped at 10 per registrable destination domain per
  day, shared across all anonymous users. Repeat links to the same URL don't
  count.
- Anonymous links can't point at other URL shorteners, free hosting such as
  `pages.dev`, IPFS gateways, tunnels, or dynamic DNS. Sign in for those; the
  full list is in [services/api/src/account-only.ts](services/api/src/account-only.ts).

## API

The public JSON API lives under `/api/v1` on `https://uwu.land`. Creating a link
and reading public click counts at `GET /api/v1/links/:slug/stats` work without
auth. Everything else expects `Authorization: Bearer ...` with an uwu.land API
key or a Clerk session JWT. Key management and billing endpoints accept a Clerk
session only.

```sh
curl -X POST https://uwu.land/api/v1/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

The endpoint reference, error codes, and response shapes are documented at
[app.uwu.land/docs](https://app.uwu.land/docs). The shared request, response,
and error types live in
[packages/shared/src/api.ts](packages/shared/src/api.ts).

## Stack

- **API worker.** Hono handles routing, D1 with Drizzle stores link records and
  metadata, and KV serves the redirect hot path and domain blocklist. Durable
  Objects handle rate limiting, abuse enforcement, link reconciliation, and
  click counting. Analytics Engine records raw click events, and Turnstile
  verifies anonymous links created on the homepage.
- **Web app.** React Router v7 in framework mode via `@cloudflare/vite-plugin`,
  styled with Tailwind CSS and Radix UI. Clerk handles auth and Stripe handles
  billing.

The visual system is "Riso Post Office", a riso-print postal metaphor. Bricolage
Grotesque sets display text and the wordmark, Instrument Sans sets body copy and
UI, and Space Mono sets postal jobs and short-link slugs, all self-hosted via
Fontsource.

## Repo layout

| Path | Purpose |
| --- | --- |
| [services/api](services/api) | Cloudflare Worker for redirects, `/api/v1`, webhooks, and cron jobs. |
| [apps/web](apps/web) | React Router v7 landing page, dashboard, and API docs for `app.uwu.land`. |
| [packages/shared](packages/shared) | Shared API contract types and tier config. |
| [packages/db](packages/db) | Drizzle schema and D1 migrations. |
| [docs](docs) | Architecture and product decision log. |

## Local development

You need Node 22+ and pnpm 11. Anything behind sign-in also needs your own Clerk
dev instance.

1. Install dependencies and apply the local D1 migrations:

   ```sh
   pnpm install
   pnpm --filter uwu-land-api exec wrangler d1 migrations apply uwu-land --local
   ```

2. Create the two local env files. They aren't interchangeable. Vite reads
   `apps/web/.env.local` and ignores `.dev.vars`, while wrangler reads
   `services/api/.dev.vars`. The web app is the odd one out.

   Copy [apps/web/.env.local.example](apps/web/.env.local.example) to
   `apps/web/.env.local` and fill in your Clerk keys. `VITE_UWU_API_URL` is
   pre-filled for the local API worker; omit it to point at production.

   Create `services/api/.dev.vars`:

   ```sh
   # services/api/.dev.vars
   CLERK_ISSUER=https://<your-subdomain>.clerk.accounts.dev   # Clerk's Frontend API URL
   CORS_DEV_ORIGIN=http://localhost:3000
   # Optional: omit to skip verification with a warning, or use Cloudflare's test secret:
   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
   ```

   `CORS_DEV_ORIGIN` is deliberately absent from `services/api/wrangler.jsonc`
   so a dev origin can never ship. Production allows `https://app.uwu.land` and
   nothing else. If you omit `CORS_DEV_ORIGIN` locally, dashboard API calls fail
   CORS while production stays fine. That is also why
   [apps/web/vite.config.ts](apps/web/vite.config.ts) pins port 3000 with
   `strictPort`.

3. Start both workers together on `:8787` for the API and `:3000` for the web
   app:

   ```sh
   pnpm dev
   ```

Other Turbo tasks from the repo root:

```sh
pnpm test          # runs vitest across every package, plus API script tests
pnpm lint          # runs biome
pnpm check-types   # runs tsc, plus react-router typegen for the web app
pnpm build         # builds the web app and dry-run bundles the API worker
```

## Docs

- [docs/decisions.md](docs/decisions.md) records the architecture and product
  decisions along with the alternatives that lost.
- [services/api/README.md](services/api/README.md) covers API worker bindings,
  secrets, cron jobs, and maintenance scripts.
- [apps/web/README.md](apps/web/README.md) covers web routes, env vars, and
  builds.

Deployment and day-2 operations runbooks are kept local rather than published.

## Self-hosting and contributions

The source is MIT, but running your own copy isn't a path this repo supports. It
assumes Cloudflare, Clerk, and Stripe accounts, and the config carries live
resource IDs for mine. You're welcome to read it and take whatever is useful.

Issues and pull requests are welcome, though this is a personal project and I
make no promises about response times.

## License

MIT. See [LICENSE](LICENSE).
