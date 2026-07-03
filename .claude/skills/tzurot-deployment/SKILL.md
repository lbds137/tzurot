---
name: tzurot-deployment
description: 'Railway deployment procedures. Invoke with /tzurot-deployment for deploying, checking logs, and troubleshooting.'
lastUpdated: '2026-07-03'
---

# Deployment Procedures

**Invoke with /tzurot-deployment** for Railway operations.

## Auto-Deploy: branch-to-environment

Both Railway environments auto-deploy from their respective branches. **No manual deploy step is required for either environment.**

| Branch    | Environment | Trigger                    |
| --------- | ----------- | -------------------------- |
| `develop` | dev         | Auto-deploys on every push |
| `main`    | prod        | Auto-deploys on every push |

For prod, the trigger is the release-PR merge from `develop` into `main` (procedure in `tzurot-git-workflow` skill). Schema changes do NOT auto-apply — see the migration step below.

### What a dev deploy proves (and does NOT prove)

**Dev has NO organic traffic.** Its only user is the project owner, and only during explicit testing sessions. A change that has "been on dev for a day" has, in the common case, executed exactly zero times beyond service boot.

| A green dev deploy proves                                                            | It does NOT prove                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| The build compiles and ships                                                         | Any request-path behavior                                |
| Services boot without crash-looping                                                  | Failure paths, fallbacks, retries                        |
| Boot-time wiring runs (pool config applies, scheduled jobs register, env vars parse) | Scheduled jobs actually _execute_ correctly              |
|                                                                                      | Anything involving real user input, load, or concurrency |

**Never cite "soaked in dev" as release-safety evidence.** For this project, **prod is the soak environment** — the honest release-safety basis is: per-PR CI (all tiers) + adversarial review, the holistic release review, blast-radius analysis of the runtime-unverified paths, and logging good enough to diagnose the first real occurrence post-hoc. When a change's failure path genuinely needs pre-prod runtime verification, that means an _explicit_ dev testing session with the user driving Discord (see `/tzurot-testing`), not passive deploy time.

## Deployment Procedure

### 1. Merge PR (triggers auto-deploy)

For feature PRs to `develop`:

```bash
gh pr merge <PR-number> --rebase --delete-branch
```

For release PRs to `main`: see `tzurot-git-workflow` skill (no `--delete-branch`).

### 2. Run Prisma migration if the PR includes one

Migrations are NOT auto-applied, and the timing differs by environment because every service auto-deploys in parallel:

```bash
# Dev (develop pushes): apply promptly after the push — the brief window is low-stakes
pnpm ops db:migrate --env dev

# Prod (release): migrate BEFORE merging the release PR, so auto-deploy lands into a
# ready schema. This is part of the release flow (tzurot-git-workflow skill, step 4):
pnpm ops release:premigrate
```

Additive migrations are safe to premigrate; destructive ones (drop/rename/tighten) need a maintenance window — `release:premigrate` refuses them without `--allow-destructive`. See `.claude/rules/03-database.md` § Deployment.

### 3. Monitor deployment

```bash
railway status --json
railway logs --service api-gateway -n 100
```

### 4. Verify health

```bash
curl https://api-gateway-<your-deployment>.railway.app/health
```

## Rollback Procedure

```bash
git revert HEAD
git push origin develop
# Railway auto-deploys the revert
```

## Log Analysis

**Incident digs: reach for `pnpm ops logs` correlation flags first.** They
encode the reliable pull-and-grep-locally pattern (the server-side `--filter`
DSL routinely misses hyphenated UUIDs) and sweep all three app services in
one command:

```bash
# Cross-service trace of one request (5000-line window per service, local match)
pnpm ops logs --env prod --request-id <uuid>

# BullMQ job trace, floored to the last 2 hours (local pino-time filter)
pnpm ops logs --env prod --job-id <id> --since 2h

# Both flags AND together; --since accepts ISO-8601 or 45m/6h/2d
pnpm ops logs --env prod --request-id <uuid> --job-id <id> --since 6h
```

Correlation mode reads the CURRENT deployment; for older windows use the
deployment-ID lookup below.

Raw CLI equivalents (single service, manual grep):

```bash
# Tail specific service (CURRENT deployment only)
railway logs --service bot-client -n 50

# Trace request across services
railway logs | grep "requestId:abc123"
```

**⚠️ NEVER grep prod logs by level.** Railway renders every pino line as
`[INFO]` regardless of its actual level, and `"level":50`-style greps return
false-clean while real `logger.error` failures exist (this wrongly read a
broken deploy as "clean" once). Grep by **message text or `err=` content**
instead:

```bash
# ✅ Find errors by content, not level
railway logs --service api-gateway | grep -iE 'failed|error:|err='

# ❌ Both of these give false-clean on Railway
# railway logs | grep "ERROR"
# railway logs | grep '"level":"error"'
```

### Pulling logs from PAST deployments

`railway logs` defaults to the most recent successful deployment. Logs from before a deploy event aren't visible by default — but Railway DOES retain them, and the CLI supports an explicit deployment-ID lookup.

When you need to investigate an event that happened before the most recent deploy:

```bash
# 1. List recent deployments to find the relevant ID + timestamp
railway deployment list --service ai-worker --environment production --limit 10
# Output: <deployment-id> | SUCCESS|REMOVED | <local-timestamp>

# 2. Pull logs from a specific deployment by ID
railway logs <DEPLOYMENT_ID> --service ai-worker --environment production --lines 5000 --filter "<search>"
```

The `--filter` flag uses Railway's query DSL (`@level:error`, quoted phrases like `"vision AND 404"`, etc.). For multi-token literal substring searches, single tokens often work better than quoted phrases — Railway's filter syntax doesn't always behave like grep.

**When this matters**: investigations into bugs that surfaced just before a release deploy, or cross-deployment timeline traces.

### Empty log results = debug the query, not the retention

Railway retains logs; an empty or suspiciously short result almost always means the **query** is wrong, not that the logs "rolled off" or "aged out" (this is a named anti-pattern in `.claude/rules/00-critical.md` § "Don't Present Speculation as Fact"). The real culprits, in order of how often they bite:

- **`--lines` has a cap (~5000).** Values like `6000`/`8000` fail with `Error in limit - Invalid input` and return **zero rows** — which looks identical to "no matching logs." Stay at `--lines 5000` or below; to reach further back, narrow by deployment ID (above) rather than raising `--lines`.
- **Filter by the field the log actually carries.** A vision/image error logs `attachmentId` and `url`, not the top-level `requestId` — so `--filter "<requestId>"` silently misses it and you see only the job-start/complete lines. When the error isn't where you expect, it's logged under a different field: pull a window and `grep` locally instead of trusting one `--filter`.
- **The `--filter` DSL is finicky.** Hyphenated tokens (`ref1-image`), quoted phrases (`"failed after"`), and special characters often match nothing. Prefer a single bare token, or pull `--lines 5000` into a file and `grep -iE` locally — local grep is predictable; the DSL is not.
- **Ended/removed deploys are still queryable** by deployment ID (above). A `REMOVED` status does not mean the logs are gone.

(Every one of these has produced a false "logs rolled off" conclusion at least once; `--lines 5000` + local grep resolved each immediately.)

## Environment Variables

```bash
# Preview changes (ALWAYS dry-run first)
pnpm ops deploy:setup-vars --env dev --dry-run

# Apply to dev
pnpm ops deploy:setup-vars --env dev

# List all for a service
railway variables --service api-gateway --json

# Set single variable
railway variables --set "KEY=value" --service ai-worker --environment development

# DELETE - Use Dashboard (CLI cannot delete!)
```

## Database Migration Procedure

> ⚠️ **Prisma uses LOCAL migrations folder!** Checkout the branch matching deployed code first.

```bash
# 1. Checkout correct branch
git checkout main  # For production

# 2. Check status
pnpm ops db:status --env prod

# 3. Apply migrations
pnpm ops db:migrate --env prod --force
```

## Running Scripts Against Railway

```bash
# Generic pattern
pnpm ops run --env dev <command>

# One-off script
pnpm ops run --env dev tsx scripts/src/db/backfill.ts

# Prisma Studio
pnpm ops run --env dev npx prisma studio
```

## Service Restart

```bash
# Note: 'railway restart' doesn't exist, use redeploy
railway redeploy --service bot-client --yes
```

## Cost Impact in Infra Recommendations

Any recommendation that changes hosting posture — keep-warm toggles, serverless
on/off, replica counts, timeout bumps that hold instances alive — MUST state its
hosting-cost impact alongside the technical rationale. A keep-warm toggle was
once recommended purely on latency grounds and overruled on cost ("will cost me
a lot more money on hosting"); prefer the cost-neutral alternative (e.g., a
timeout bump) unless the user opts into spend.

## Troubleshooting Checklist

| Symptom            | Check                           | Solution                |
| ------------------ | ------------------------------- | ----------------------- |
| Service crashed    | `railway logs -n 100`           | Check missing env vars  |
| Slow responses     | `railway logs \| grep duration` | Check DB/Redis          |
| Bot not responding | bot-client logs                 | Verify DISCORD_TOKEN    |
| Migration failed   | `pnpm ops db:status`            | Apply with `db:migrate` |

## References

- Railway CLI: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- Railway Operations: `docs/reference/deployment/RAILWAY_OPERATIONS.md`
