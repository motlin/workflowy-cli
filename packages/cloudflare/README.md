# @workflowy/cloudflare

Cloudflare Worker host for the web app. Never deploy from here without Craig.

Test harness: Node vitest project `cloudflare` bundles `src/worker.ts` with esbuild and runs it in Miniflare. `@cloudflare/vitest-pool-workers` was rejected because it requires vitest ^4.1 and the catalog is on 5.0.5. Keep `compatibility_date` no newer than the installed workerd supports.

Run `vp run --filter @workflowy/cloudflare types` after changing `wrangler.jsonc`.

## Runbook

### Local dev (no Cloudflare account)

`just cf-dev` builds the web client and runs `wrangler dev` on port 8787 (`just cf-dev 8799` for another port). Workerd runs locally with R2 and the Durable Object simulated, state persists in `packages/cloudflare/.wrangler/state`, and `ACCESS_DEV_IDENTITY=dev` skips Cloudflare Access. Confirm it is up with `lsof -i -P -n | grep LISTEN` and `curl -sI http://localhost:8787/`; another process may already hold the port. Put secrets for local runs in `packages/cloudflare/.dev.vars` (gitignored).

`just cf-test` runs the Worker tests (also part of `just test`). `just cf-smoke` runs a Playwright smoke test against a fresh `wrangler dev` with a fake upstream: it loads the home page, edits a node, and checks the edit is shown and written through. It is outside `verify` and needs a Chromium install (set `CHROMIUM_PATH` or use the ms-playwright cache). It never calls the real Workflowy API.

### Names

- Secrets (`wrangler secret put`): `WORKFLOWY_API_KEY`, `WORKFLOWY_USERNAME`, `WORKFLOWY_PASSWORD`, optionally `WORKFLOWY_SESSION_COOKIE` (copy from `.llm/workflowy-session`; avoids password login from datacenter IPs).
- Vars in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS`, `ALLOWED_SERVICE_TOKENS`, `SYNC_INTERVAL_MINUTES`; optional `TREE_SNAPSHOT=false` to serve search from SQL.
- R2 bucket `workflowy-snapshots`; Durable Object class `UserStore`.

### Deploy (Craig only)

- `wrangler login` from `packages/cloudflare`; put the `account_id` in the gitignored `wrangler.local.jsonc` or pass `CLOUDFLARE_ACCOUNT_ID`.
- Create the bucket: `wrangler r2 bucket create workflowy-snapshots`.
- Zero Trust: create an Access self-hosted application for the Worker hostname with a policy allowing only `motlin1@gmail.com`. Copy the team domain and the AUD tag into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Disable the `workers.dev` route if using a custom domain so Access cannot be bypassed.
- Admin calls from the CLI or curl: in Zero Trust create a service token (Access > Service Auth), add a Service Auth policy for it on the application, and set `ALLOWED_SERVICE_TOKENS="<client-id>=motlin1@gmail.com"` (comma-separated pairs; the identity is the user whose Durable Object the token reaches; an unmapped token gets 403). Pass the credentials with `--access-client-id`/`--access-client-secret` or `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`; for curl send `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.
- Set the secrets above with `wrangler secret put`.
- `CONFIRM_DEPLOY=1 just cf-deploy` (refuses without it; never part of `verify`).
- Seed the durable settings, which the sync does not copy: `just cf-seed-settings https://<worker-host>` reads `local_settings` from the local cache and PUTs it to `/api/admin/local-settings` (an Access-protected admin route; `GET` lists what is stored). Run it through an Access-authenticated path, or try it first against `just cf-dev`.
- `POST /api/admin/sync`, then watch `GET /api/admin/status`. Record CPU time and peak memory from Workers Logs; if the import hits the memory limit, lower the batch size or split the export across ticks.
- Spot-check against the local app: node counts match, and a write from the Cloudflare UI shows up on workflowy.com and later in the local cache.
