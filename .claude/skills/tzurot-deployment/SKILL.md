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
# Tail specific service
railway logs --service bot-client -n 50

# Search for errors
railway logs --service api-gateway | grep "ERROR"

# Trace request across services
railway logs | grep "requestId:abc123"

# Find errors
railway logs | grep '"level":"error"'
```

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
