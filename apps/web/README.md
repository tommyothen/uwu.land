# uwu-land-web

The React Router v7 (framework mode) app for app.uwu.land: the landing page with
anonymous shortening, the Clerk-authenticated dashboard (links, API keys, account,
and First-Class billing), and the public API docs. It runs as a Cloudflare Worker
through the Cloudflare Vite plugin.

The app is an ordinary consumer of `/api/v1`. It calls the API worker from the
client with Clerk session JWTs and holds no data of its own. See the
[root README](../../README.md) for the product overview and API contract.

## Architecture

| Path | Purpose |
| --- | --- |
| `workers/app.ts` | Worker entry, the React Router request handler (`wrangler.jsonc` `main`) |
| `app/root.tsx`, `app/entry.server.tsx` | Document shell, providers, SSR entry |
| `app/routes.ts` | Route table (below) |
| `app/routes/` | Route modules |
| `src/components/` | UI: `shorten-box`, `link-table`, `link-create`, `key-*`, `account-panel`, `site-header`, `postal/`, `ui/` (shadcn primitives) |
| `src/lib/` | `api.ts` (typed `/api/v1` client), `errors.ts`, `theme.ts`, `cloud-paths.ts`, `utils.ts` |
| `src/app/docs/` | API docs content |

### Routes

```
/                index  → landing + anonymous shortening
/docs                   → public API docs
/sign-in/*  /sign-up/*  → Clerk auth
/dashboard              → authenticated layout
  ├ index               → links
  ├ /keys               → API keys
  └ /account            → account + First-Class billing
/404, /*                → not found (catch-all)
```

Auth uses [`@clerk/react-router`](https://clerk.com/docs/references/react-router).
Billing goes through the API worker's `/api/v1/billing/*` endpoints and its Stripe
webhooks (Checkout and Billing Portal); this app only starts the redirect.

## Design system

"Riso Post Office": riso-print grain over a postal metaphor. The type stack is
Bricolage Grotesque (display and wordmark), Instrument Sans (body and UI), and
Space Mono (postal jobs and slugs), all self-hosted via Fontsource. Styling uses
shadcn tokens, and `theme-toggle.tsx` with `src/lib/theme.ts` handles light and dark.

## Environment

Vite reads `.env.local`, not `.dev.vars` (that file belongs to the API worker).
Copy `.env.local.example`:

| Var | Notes |
| --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_…` (public). Baked at build time. |
| `CLERK_SECRET_KEY` | `sk_test_…`. Server-side only. |
| `VITE_UWU_API_URL` | Defaults to `https://uwu.land`; set `http://localhost:8787` to hit a local API worker. |

`VITE_` vars are inlined at build time, so a production build needs the production
publishable key present when `build` runs.

## Local development

The app needs the API worker running, so use two terminals:

```sh
# terminal 1: API worker (see services/api/README.md)
cd services/api
pnpm exec wrangler dev --port 8787

# terminal 2: web app
pnpm --filter uwu-land-web dev        # vite --port 3000
```

## Testing

```sh
pnpm --filter uwu-land-web test         # vitest (component + lib specs, *.test.tsx / *.test.ts)
pnpm --filter uwu-land-web check-types  # react-router typegen && tsc --noEmit
pnpm --filter uwu-land-web lint         # biome
```

## Build and deploy

```sh
pnpm --filter uwu-land-web build      # react-router build → build/
pnpm --filter uwu-land-web deploy     # wrangler deploy
```

Deploys run through Cloudflare Workers Builds on push to `main` (root directory
`apps/web`). Unlike the API worker, this app needs a build step (`react-router
build`) because the Vite bundle inlines the `VITE_` vars. `app.uwu.land` is
attached to this worker as a custom domain (see the commented `routes` block in
`wrangler.jsonc`).
