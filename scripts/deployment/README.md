# Deployment (ops CLI pointers)

**Note:** Deployment tasks are handled by the ops CLI. See `tzurot-deployment` skill for full reference.

## Ops CLI Commands

Two common examples follow; the full list of deploy commands is in `docs/reference/tooling/OPS_CLI_REFERENCE.md` § Deploy Commands.

```bash
# Setup Railway environment variables from .env
pnpm ops deploy:setup-vars --env dev --dry-run
pnpm ops deploy:setup-vars --env dev

# Delete a Railway environment variable (the Railway CLI cannot)
pnpm ops deploy:var-delete --env dev --service bot-client --name SOME_KEY --dry-run
pnpm ops deploy:var-delete --env prod --shared --name SOME_KEY
```

Dev deploys come from `develop`'s Railway auto-deploy — a push to `develop` redeploys each dev service whose watch paths the push touches, not the whole environment; `pnpm ops deploy:watch-check` verifies those patterns cover every Dockerfile COPY source. There is no manual dev-deploy command.

## Creating Releases

Releases are published with `pnpm ops release:publish` — the full procedure (version bump, release PR, tag + GitHub release) lives in the `/tzurot-git-workflow` skill, and the release-notes format is defined in that skill's § 2 Write Release Notes.

**See:** `tzurot-deployment` skill for Railway-specific commands and troubleshooting
