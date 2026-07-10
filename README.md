# uwu.land

uwu.land is a tiny URL shortener growing into a small public API product with anonymous shortening, account-managed links, API keys, and tiered abuse protection.

uwu.land is free forever, and will always be free with no ads or account creation required.

## Repo layout

| Path | Purpose |
| --- | --- |
| `services/api` | Cloudflare Worker for redirects and `/api/v1`. |
| `apps/web` | Future Next.js dashboard and landing app. |
| `packages/shared` | Shared API contract types and tier config. |
| `packages/db` | Future Drizzle schema and D1 helpers. |
| `docs` | Product specs and implementation plans. |

## Decisions

| Date | Decision | Notes |
| --- | --- | --- |
| 2026-07-10 | Restructure as a turborepo | Use pnpm workspaces, Turborepo, Biome, and TypeScript-source internal packages. |
| 2026-07-10 | Use Hono for the API Worker | Keep routing small and explicit for Cloudflare Workers. |
| 2026-07-10 | Use `@cloudflare/vitest-pool-workers` | Exercise KV and Worker behavior inside workerd-backed tests. |
| 2026-07-10 | Keep KV as the redirect hot path | D1 becomes the metadata plane; redirects stay KV-only. |

## License

uwu.land is licensed under the MIT License. See [LICENSE](LICENSE) for more information.
