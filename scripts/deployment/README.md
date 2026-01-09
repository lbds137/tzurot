# Deployment Scripts

Scripts for deploying to Railway and managing environment variables.

## Scripts

- **deploy-railway-dev.sh** - Deploy to Railway development environment
- **update-gateway-url.sh** - Update GATEWAY_URL environment variable
- **verify-build.sh** - Verify all services build successfully before deployment

## Usage

```bash
# Deploy to Railway dev
./scripts/deployment/deploy-railway-dev.sh

# Setup Railway variables (use pnpm ops instead)
pnpm ops deploy:setup-vars --env dev --dry-run
pnpm ops deploy:setup-vars --env dev
```

## Creating Releases

Use `gh` CLI directly for creating releases (see `tzurot-docs` skill for formatting):

```bash
gh release create v3.0.0-alpha.50 \
  --title "v3.0.0-alpha.50 - Feature Name" \
  --notes "Release notes here..."
```

**⚠️ See:** `tzurot-deployment` skill for Railway-specific commands and troubleshooting
