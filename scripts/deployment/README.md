# Deployment Scripts

Scripts for deploying to Railway, managing environment variables, and creating releases.

## Scripts

- **deploy-railway-dev.sh** - Deploy to Railway development environment
- **setup-railway-variables.sh** - Configure Railway environment variables for all services
- **update-gateway-url.sh** - Update GATEWAY_URL environment variable
- **verify-build.sh** - Verify all services build successfully before deployment
- **create-release.sh** - Create a new release with version tagging

## Usage

```bash
# Deploy to Railway dev
./scripts/deployment/deploy-railway-dev.sh

# Setup Railway variables
./scripts/deployment/setup-railway-variables.sh

# Create a release
./scripts/deployment/create-release.sh v3.0.0-alpha.50
```

**⚠️ See:** `tzurot-deployment` skill for Railway-specific commands and troubleshooting
