# Deployment Scripts

**Note:** Most deployment tasks are now handled by the ops CLI. See `tzurot-deployment` skill for full reference.

## Ops CLI Commands (Preferred)

```bash
# Verify build before deployment
pnpm ops deploy:verify

# Update gateway URL
pnpm ops deploy:update-gateway <url>

# Setup Railway variables
pnpm ops deploy:setup-vars --env dev --dry-run
pnpm ops deploy:setup-vars --env dev
```

## Legacy Scripts

The following scripts have been migrated to ops CLI and removed:

- ~~deploy-railway-dev.sh~~ → `pnpm ops deploy:setup-vars`
- ~~update-gateway-url.sh~~ → `pnpm ops deploy:update-gateway`
- ~~verify-build.sh~~ → `pnpm ops deploy:verify`

## Creating Releases

Use `gh` CLI directly for creating releases (see `tzurot-docs` skill for formatting):

```bash
gh release create v3.0.0-alpha.50 \
  --title "v3.0.0-alpha.50 - Feature Name" \
  --notes "Release notes here..."
```

**See:** `tzurot-deployment` skill for Railway-specific commands and troubleshooting
