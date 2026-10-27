# @workflowy/cloudflare

Cloudflare Worker host for the web app. Never deploy from here without Craig.

Test harness: Node vitest project `cloudflare` bundles `src/worker.ts` with esbuild and runs it in Miniflare. `@cloudflare/vitest-pool-workers` was rejected because it requires vitest ^4.1 and the catalog is on 5.0.5. Keep `compatibility_date` no newer than the installed workerd supports.

Run `vp run --filter @workflowy/cloudflare types` after changing `wrangler.jsonc`.
