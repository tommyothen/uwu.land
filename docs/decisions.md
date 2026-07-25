# uwu.land — decisions

Why the architecture is the way it is. Git history records what changed; this
records which alternative was rejected and on what grounds, so a future change
back to one of them starts from the original reasoning rather than from scratch.

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
| 2026-07-23 | Lifetime First-Class + 25% launch offer | $4/mo, $79 lifetime; launch: $3/mo (forever coupon), $59 lifetime (launch price); yearly removed from sale, grandfathered for entitlement. |
| 2026-07-25 | Reprice lifetime: $79/$59 → $40/$30 | $79 was ~20 months of monthly; $40 is 10 and the launch $30 is 7.5, which undercuts a year of subscribing on purpose. With no users yet, adoption is worth more than revenue per sale, and marginal cost per user on Workers/KV/D1 is negligible. Both launch prices are now exactly 25% off, so the advertised discount is literal. Nothing had been sold, so no grandfathering. |
| 2026-07-25 | Ship the `azp` and CORS dev-origin controls as opt-in vars | `CLERK_AUTHORIZED_PARTIES` and `CORS_DEV_ORIGIN` are absent from `wrangler.jsonc` and inert when unset. An `azp` allowlist that rejects every token is a worse outage than the cross-app risk it prevents, and Clerk omits `azp` outside browser-minted tokens; leaving the dev origin in the production allowlist is the thing actually worth fixing, and an absent var cannot ship it by accident. |
| 2026-07-25 | No per-minute create limit | Kept the single daily fixed window and left burst limiting as a future pricing lever. Reviewed the related abuse-surface tradeoffs at the same time and accepted them deliberately; the detail lives in the local operations runbook rather than here. |
