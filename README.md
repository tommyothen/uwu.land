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
| `docs` | Maintenance and operations notes, and the decision log. |

## Web app

`apps/web` is the React Router v7 framework-mode app for app.uwu.land: landing page with
anonymous shortening, Clerk-authenticated dashboard (links, API keys, account),
direct Stripe Billing for First-Class subscriptions and lifetime purchases, and the public API docs at
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

The same file needs `CORS_DEV_ORIGIN=http://localhost:3000`. Production allows
`https://app.uwu.land` and nothing else, and the dev origin is deliberately
absent from `wrangler.jsonc` so it can never ship; without it the dashboard's
API calls fail CORS locally while production is fine. That is also why
`apps/web/vite.config.ts` pins port 3000 with `strictPort`.

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
| `GET /api/v1/me` | Required | Return user id, tier, billing-history availability, limits, and usage. |
| `POST /api/v1/keys` | Clerk session only | Create an API key. The secret is shown once in the response. |
| `GET /api/v1/keys` | Clerk session only | List non-revoked API keys without hashes or secrets. |
| `DELETE /api/v1/keys/:id` | Clerk session only | Revoke an API key. API keys cannot manage keys. |
| `POST /api/v1/billing/checkout` | Clerk session only | Create a Stripe Checkout Session for a monthly First-Class subscription or a one-time lifetime purchase. |
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

## Stripe configuration

The Worker reads these from `services/api/wrangler.jsonc` vars (Price and coupon
IDs are not secrets); `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are
Wrangler secrets.

| Var | What it points at |
| --- | --- |
| `STRIPE_PRICE_ID_MONTHLY` | Recurring monthly Price, $4. |
| `STRIPE_PRICE_ID_YEARLY` | Retired yearly Price. Kept so grandfathered subscribers still resolve to `pro`; never offered at checkout. |
| `STRIPE_PRICE_ID_LIFETIME` | One-time Price, $40. |
| `STRIPE_PRICE_ID_LIFETIME_LAUNCH` | One-time Price, $30. Used instead of the above while `LAUNCH_OFFER` is true. |
| `STRIPE_LAUNCH_COUPON_ID` | 25% off, `duration: forever`, applied to monthly checkouts while `LAUNCH_OFFER` is true. Set `max_redemptions` to `LAUNCH_LIMIT` so Stripe enforces the advertised cap. |

The webhook endpoint must subscribe to all of these. The failures are silent:
a missing `checkout.session.completed` takes payment without entitling anyone,
and a missing `charge.refunded` leaves refunded buyers entitled forever.

- `checkout.session.completed` — records lifetime purchases.
- `checkout.session.async_payment_succeeded` — the same, for a delayed-notification method (bank debit or transfer) that completes the session unpaid and clears later.
- `charge.refunded` — revokes a fully refunded lifetime purchase.
- `customer.subscription.created`, `.updated`, `.paused`, `.resumed`, `.deleted` — subscription entitlement.

The list is `RELEVANT_EVENT_TYPES` in `services/api/src/stripe-webhook.ts`;
anything else is acknowledged with a 200 and not recorded.

### Running a lifetime promotion

The lifetime checkout accepts **promotion codes** (`allow_promotion_codes`), so a
promo needs no deploy: create a coupon plus a promotion code in Stripe and share
the code. Constrain it there rather than in code — `max_redemptions`,
`expires_at`, a single `customer`, `restrictions.first_time_transaction`,
`restrictions.minimum_amount`. A code restricted to one customer with
`max_redemptions: 1` is also the way to test a real purchase cheaply.

Monthly is different: Checkout permits one discount per session, and while
`LAUNCH_OFFER` is true the launch coupon is attached server-side, so monthly
cannot also take codes. It accepts them automatically once the launch offer ends.

**Do not issue a 100%-off lifetime code.** A free session takes no payment, so
Stripe creates no payment intent, and `stripe_lifetime_purchases` requires one —
the webhook acknowledges the event and logs "Lifetime session was fully
discounted", leaving the buyer unentitled until someone fixes it by hand. Leave
at least a nominal charge. Supporting genuinely free grants means making
`payment_intent_id` nullable in a new migration.

### Refunding a lifetime purchase

**Refund in full, always.** `charge.refunded` revokes the purchase only when the
payment intent is fully refunded; a partial refund leaves the buyer entitled on
purpose (a tax correction or goodwill gesture should not cost someone the
product they bought). `/refunds` therefore promises the whole payment back
within 14 days with no deduction for use.

Two cases still need a human:

- **A refund after a monthly→lifetime upgrade** does not un-schedule the
  cancellation that upgrade set on their subscription. Re-enable renewal in the
  Stripe portal, or the customer silently loses the monthly plan at period end
  (and, during the launch, its forever coupon).
- **A lost chargeback** pulls the money without firing `charge.refunded`, so the
  row stays `paid` and the buyer keeps First-Class. Refund the charge in Stripe
  to revoke it, or update the row by hand.

#### Duplicate lifetime charges

The already-First-Class check in `createBillingCheckout` runs at session
creation, so two checkouts started in parallel — or a stale session completed
after a later one succeeded — can both be paid. The result is two `paid` rows
in `stripe_lifetime_purchases` for one buyer. Find them (via
`wrangler d1 execute uwu-land --remote`):

```sql
SELECT user_id, COUNT(*) AS paid_rows
FROM stripe_lifetime_purchases
WHERE status = 'paid'
GROUP BY user_id
HAVING COUNT(*) > 1;
```

Resolution is a full refund of the duplicate in Stripe: match the charge to
its row by `payment_intent_id` (refund the later payment), and
`charge.refunded` flips only that row to `refunded`. The tier recompute still
finds the surviving `paid` row, so the buyer keeps First-Class throughout —
there is a characterisation test pinning this in
`services/api/test/stripe-webhook.test.ts`.

### Ending the launch offer

Flip `LAUNCH_OFFER` to `false` in `packages/shared/src/tiers.ts` and push. Both
workers read the constant, so the badge and the checkout discount cannot drift.
Existing launch subscribers keep their forever coupon; nothing else changes.

Nothing enforces the advertised `LAUNCH_LIMIT` across both plans: the coupon's
`max_redemptions` caps the monthly lane only, because lifetime buyers get the
launch Price and never touch the coupon. Add the two numbers up by hand:

```sh
stripe get /v1/coupons/LAUNCH25 --live   # times_redeemed → monthly takers
```

```sql
-- launch lifetime buyers (via wrangler d1 execute uwu-land --remote)
SELECT COUNT(*) FROM stripe_lifetime_purchases
WHERE price_id = '<STRIPE_PRICE_ID_LIFETIME_LAUNCH>' AND status = 'paid';
```

### Tax

Checkout sends `automatic_tax[enabled]=true` on both branches, so **Stripe Tax
must be active** or every session errors. Prices must resolve to tax-inclusive,
because `/refunds` promises the advertised price is the price paid.

Inclusivity comes from the account default, set at Settings → Tax → Business
information → "Include tax in prices" → **Yes**. Do not leave it on
"Automatic": that resolves to *exclusive* for USD and would add tax on top.
Prices themselves can stay `tax_behavior: unspecified` and inherit the default —
that is the current setup. A Price with an explicit `inclusive`/`exclusive` value
cannot be changed afterwards, so an `exclusive` one has to be recreated.

Tax registrations are separate and deliberately absent: with none, Stripe
calculates zero tax and charges no Tax fees, while
[monitoring](https://dashboard.stripe.com/tax/transactions) tracks where
obligations are accruing.

## Maintenance

Run these from `services/api`; they operate on remote production infrastructure.

- `pnpm ban example.com` — block a destination domain and its subdomains.
- `pnpm unban example.com` — remove a domain block.
- `pnpm banned` — list blocked domains.
- `pnpm abuse:top -- --days 14` — report destination hosts with the most links in the last N days (default 7).
- `pnpm purge:domain example.com` — dry-run deletion of links for a domain and subdomains; add `--yes` to delete their D1 rows and UWU/CLICKS KV keys.

## Decisions

Architecture and product decisions, with the reasoning and the rejected
alternatives, live in [docs/decisions.md](docs/decisions.md).

## License

uwu.land is licensed under the MIT License. See [LICENSE](LICENSE) for more information.
