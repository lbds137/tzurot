---
name: tzurot-deployment
description: 'Railway deployment procedures. Invoke with /tzurot-deployment for deploying, checking logs, and troubleshooting.'
lastUpdated: '2026-04-20'
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

## Deployment Procedure

### 1. Merge PR (triggers auto-deploy)

For feature PRs to `develop`:

```bash
gh pr merge <PR-number> --rebase --delete-branch
```

For release PRs to `main`: see `tzurot-git-workflow` skill (no `--delete-branch`).

### 2. Run Prisma migration if the PR includes one

Migrations are NOT auto-applied. Run immediately after merge to minimize the window where new code runs against the old schema:

```bash
pnpm ops db:migrate --env dev    # for develop pushes
pnpm ops db:migrate --env prod   # for main pushes
```

### 3. Monitor deployment

```bash
railway status --json
railway logs --service api-gateway -n 100
```

### 4. Verify health

```bash
curl https://api-gateway-development-83e8.up.railway.app/health
```

## Rollback Procedure

```bash
git revert HEAD
git push origin develop
# Railway auto-deploys the revert
```

## Log Analysis

```bash
# Tail specific service (CURRENT deployment only)
railway logs --service bot-client -n 50

# Search for errors
railway logs --service api-gateway | grep "ERROR"

# Trace request across services
railway logs | grep "requestId:abc123"

# Find errors
railway logs | grep '"level":"error"'
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

**When this matters**: investigations into bugs that surfaced just before a release deploy, or cross-deployment timeline traces. Surfaced 2026-04-25 during the LangChain reasoning-extraction investigation when the leaked request happened on the prior deployment.

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
