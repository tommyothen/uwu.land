# uwu-land-api

The Cloudflare Worker behind `uwu.land`. One script does two jobs: the short-link
redirect hot path and the versioned `/api/v1` JSON API. It also receives Clerk and
Stripe webhooks and runs scheduled maintenance.

For the product overview, the full `/api/v1` endpoint table, and the stable error
codes, see the [root README](../../README.md). This file covers working inside the
package.

## Architecture

Routing is [Hono](https://hono.dev). `src/worker.ts` wires up the routes, the
scheduled (cron) handler, and the `Enforcement` Durable Object export.

| Area | Files |
| --- | --- |
| Redirects | `redirect.ts` (KV hot path), `slugs.ts`, `normalize.ts` |
| Links API | `links.ts`, `link-reconciliation.ts`, `click-materialization.ts` |
| API keys | `keys.ts`, `keys-routes.ts` |
| Auth & identity | `auth.ts` (Clerk JWT + API-key verification), `identity.ts`, `crypto-utils.ts` |
| Billing | `billing-routes.ts`, `billing-shared.ts`, `stripe-webhook.ts` |
| Clerk lifecycle | `clerk-webhook.ts` |
| Abuse control | `abuse.ts`, `banned.ts`, `ban-sync.ts`, `rate-limit.ts`, `enforcement.ts` (Durable Object) |
| Plumbing | `errors.ts`, `request-utils.ts`, `env.d.ts` |

Redirects stay KV-only for latency, so D1 is the metadata and abuse plane. Clicks
are counted with eventual consistency and materialized in bounded batches on the
five-minute cron.

## Bindings

Declared in `wrangler.jsonc`:

| Binding | Type | Purpose |
| --- | --- | --- |
| `UWU` | KV | Redirect keys, reserved/dedup indexes, `banned:<domain>` blocklist |
| `CLICKS` | KV | Per-slug click counters |
| `CLICK_EVENTS` | Analytics Engine | Raw click events (created on first write) |
| `DB` | D1 (`uwu-land`) | Users, links, API keys, Stripe/Clerk state |
| `ENFORCEMENT` | Durable Object | Per-IP rate limiting / abuse enforcement |

Cron triggers: `*/5 * * * *` reconciles links and materializes clicks;
`0 6 * * *` refreshes the ban list.

## Config, vars, and secrets

Non-secret `vars` live in `wrangler.jsonc`: `CLERK_ISSUER`,
`STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`.

Secrets never go in `vars`. Set them with `wrangler secret put`:

| Secret | Used by |
| --- | --- |
| `CLERK_WEBHOOK_SIGNING_SECRET` | `/webhooks/clerk` signature verification |
| `STRIPE_SECRET_KEY` | Stripe API calls (Checkout, Billing Portal, customers) |
| `STRIPE_WEBHOOK_SECRET` | `/webhooks/stripe` signature verification |

Locally these go in `services/api/.dev.vars`, which wrangler reads and the web app
ignores. See `.env.local.example` for the shape.

## Local development

```sh
cd services/api
pnpm exec wrangler d1 migrations apply uwu-land --local   # first run / after wiping .wrangler/state
pnpm exec wrangler dev --port 8787
```

`wrangler dev` simulates KV, D1, the Durable Object, and Analytics Engine locally.
For dashboard-JWT auth in dev, set `CLERK_ISSUER` in `.dev.vars` to your Clerk app's
Frontend API URL (`https://<slug>.clerk.accounts.dev`).

## Testing

```sh
pnpm --filter uwu-land-api test
```

This runs the [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
specs in `test/` (real KV/D1/DO behavior inside workerd) plus the Node maintenance
tests in `scripts/*.node-tests.mjs`. `pnpm lint` (Biome) and `pnpm check-types`
(`tsc --noEmit`) cover the rest of CI.

## Deploy

Deploys run through Cloudflare Workers Builds on push to `main` (root directory
`services/api`, deploy command `wrangler deploy`). There is no build step, because
wrangler bundles the TypeScript source of `@uwu/db` and `@uwu/shared` directly. To
deploy by hand:

```sh
pnpm exec wrangler deploy
```

Schema changes ship separately, and before the code that needs them:

```sh
pnpm exec wrangler d1 migrations apply uwu-land --remote
```

Migrations live in `packages/db/migrations` (referenced via `migrations_dir`).

## Maintenance scripts

Run these from `services/api`; they operate on remote production infrastructure.
The [root README](../../README.md#maintenance) has the full list: `pnpm ban`,
`pnpm unban`, `pnpm banned`, `pnpm abuse:top`, `pnpm purge:domain`.
