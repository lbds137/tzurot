# Pre-deploy migrations (Railway)

Eliminates the **breaking-migration deploy window**: Railway auto-deploys new code on
merge, but Prisma migrations were applied manually afterward (`pnpm ops db:migrate`),
so for a few minutes the new code ran against the old schema. The beta.140 incident was
exactly this — `column llm_configs.kind does not exist` → personality-load failures →
user-visible "No response received" for ~3 minutes.

## How it works

`services/api-gateway/railway.json` sets a [pre-deploy command](https://docs.railway.com/deployments/pre-deploy-command):

```json
{ "deploy": { "preDeployCommand": "npx -y prisma@7 migrate deploy" } }
```

Railway runs the pre-deploy command **between build and deploy**, in the service's
private network (so `DATABASE_URL` is present), and **blocks the deploy if it exits
non-zero**. So pending migrations are applied to that environment's DB _before_ the new
api-gateway code serves traffic — no window, and a failed migration loudly blocks the
deploy instead of silently breaking prod.

It runs on **both** dev (push to `develop`) and prod (release merge to `main`), so the
manual `pnpm ops db:migrate` step is no longer required for api-gateway deploys.

### Runner-image prerequisites (all satisfied)

`prisma migrate deploy` needs, in the api-gateway runtime image:

1. **The prisma CLI** — supplied by `npx -y prisma@7` (fetched/cached at deploy; `-y`
   auto-confirms the install). Pinned to major 7 to match `@prisma/client`/`prisma`
   (`^7.8.0`); bump the `@7` when the project moves to Prisma 8.
2. **`prisma.config.ts`** — the schema's datasource has **no `url`** (the runtime uses
   the `@prisma/adapter-pg` driver adapter); `prisma.config.ts` feeds `DATABASE_URL` to
   _migrate_. The Dockerfile now `COPY`s it into the runner.
3. **`DATABASE_URL`** — already set on the Railway api-gateway service.
4. **The migrations folder** — already copied (`COPY prisma ./prisma`).

## ⚠️ Verify before relying on this (a failed pre-deploy blocks deploys)

This could not be verified locally — it depends on Railway-side behavior. Before trusting
it on prod:

1. **Confirm Railway picks up the config.** The api-gateway service's _Config-as-Code_
   path (dashboard → Settings) must resolve to `services/api-gateway/railway.json` (it
   depends on the service's root directory). If the path is wrong, Railway silently
   ignores the file (a safe no-op — but the window isn't fixed).
2. **Dry-run the command in the dev Railway shell** for the api-gateway service:
   `npx -y prisma@7 migrate deploy`. With no pending migrations it's a safe no-op
   ("No pending migrations"). Confirm it connects + exits 0.
3. **Then let a dev deploy exercise it** (push a no-op to `develop`) and confirm the
   deploy succeeds with the pre-deploy step green.

Only after dev is confirmed should this reach prod (the release merge to `main`).

## Caveat — multi-service deploys (not fully closed by this alone)

This gates **api-gateway**'s new code behind the migration. But a merge triggers **all**
services' deploys in parallel, and **ai-worker** also reads new columns (e.g. vision
`kind`) — its new code can still briefly hit the pre-migration schema during api-gateway's
migrate. The complete fix pairs this with **backward-compatible (expand-contract)
migrations** so every service tolerates the old schema during the window. Tracked as a
follow-up; the pre-deploy command is the larger, structural half.

Do **not** add a pre-deploy migrate to a second service — concurrent `migrate deploy`
runs would race (it's advisory-locked, so safe, but redundant and confusing). Keep
api-gateway as the single migration runner.
