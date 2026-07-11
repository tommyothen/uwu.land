# uwu.land — maintainer runbook

Day-2 operations for the site maintainer. All commands run from `services/api`
(`cd services/api` first, or use `pnpm --filter uwu-land-api <script>` from the
repo root). They talk to **production** Cloudflare resources via wrangler, so
they need your logged-in wrangler session.

## Deploying link lifecycle reconciliation

Apply D1 migrations before deploying an API version that uses link lifecycle
state:

```sh
npx wrangler d1 migrations apply uwu-land --remote
```

The Worker retries incomplete KV publication and deletion every five minutes.
Rows in `pending_publish` or `pending_delete` retain their slug reservation;
`reconcile_attempts`, `last_reconcile_at`, and `last_reconcile_error` provide
the first place to inspect persistent failures.

## Blocking abusive domains

Blocking is a `banned:<domain>` key in the production `UwU` KV namespace. The
worker checks it at create time with a hostname **suffix** match, so banning
`evil.com` also blocks `sub.evil.com`. Banning stops NEW links only — existing
links to that domain keep redirecting until you purge them (below).

```sh
pnpm ban evil.com        # block a domain (and its subdomains) at create time
pnpm unban evil.com      # remove the block
pnpm banned              # list everything currently banned
```

## Finding who is abusing us

Every create (including anonymous ones, since 2026-07-10) writes a row to D1,
so link volume can be aggregated by destination hostname:

```sh
pnpm abuse:top               # top destination domains, last 7 days
pnpm abuse:top --days 30     # wider window
```

Output: hostname, total links, anonymous links, newest `createdAt`. A domain
with a pile of anonymous links created in a burst is your abuse signature —
`pnpm ban` it, then decide whether to purge.

## Purging a domain's existing links

Deletes the D1 rows AND the KV redirect/click keys for every link pointing at
a domain (or its subdomains). **Destructive** — dry-runs by default:

```sh
pnpm purge:domain evil.com          # DRY RUN: prints what would be deleted
pnpm purge:domain evil.com --yes    # actually deletes
```

Typical incident response is: `pnpm abuse:top` → `pnpm ban <domain>` →
`pnpm purge:domain <domain>` (dry-run, eyeball it) → `--yes`.

## Related facts worth remembering

- `uwu.land` itself is hard-blocked as a destination in the worker code
  (`isOwnHostname` in `services/api/src/links.ts`) — no redirect loops.
- Anonymous creates reserve normalized URL hashes in D1 and publish a
  `urlmap:<sha256>` KV fast-path: the same destination submitted anonymously
  twice returns the same slug, including while publication is being retried.
  Authenticated creates always mint fresh slugs.
- Rate limits live in `packages/shared/src/tiers.ts` (anon 15/day + 3/min,
  free 120/day + 60/min, pro 2000/day + 600/min) — tune there, no schema
  changes needed.
- Anonymous links have no owner, so they can't be deleted via the public API —
  `purge:domain` (or manual wrangler kv/d1 surgery) is the only way to remove
  them.
