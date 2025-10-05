# Railway Shared Variables Setup

This guide explains how to use the automated script to set up shared and service-specific environment variables in Railway.

## Quick Start

```bash
# 1. First, always do a dry-run to preview what will be set
./scripts/setup-railway-variables.sh --dry-run

# 2. Review the output carefully - verify all values look correct

# 3. If everything looks good, run it for real
./scripts/setup-railway-variables.sh

# 4. Verify variables were set correctly
railway variables
```

## Script Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be set without actually making changes |
| `--yes`, `-y` | Skip confirmation prompts (for CI/CD) |
| `--help`, `-h` | Show help message |

## How It Works

### 1. Reads from Your .env File

The script automatically reads your current `.env` file and uses those values. This means:
- ✅ No need to re-enter values you already have
- ✅ Consistent with your local development setup
- ✅ Secrets are hidden in output (***set***)

### 2. Categorizes Variables

The script sets variables in three categories:

**Shared (all services)**:
- `DATABASE_URL` - PostgreSQL connection
- `QDRANT_URL` - Vector database
- `QDRANT_API_KEY` - Qdrant authentication
- `AI_PROVIDER` - Which AI provider to use
- `GEMINI_API_KEY` - Gemini API key
- `DEFAULT_AI_MODEL` - Default model
- `WHISPER_MODEL` - Audio transcription
- `VISION_FALLBACK_MODEL` - Image analysis
- `EMBEDDING_MODEL` - Vector embeddings
- `NODE_ENV` - Environment (production/development)
- `LOG_LEVEL` - Logging verbosity

**bot-client only**:
- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Discord application ID

**api-gateway only**:
- `API_GATEWAY_PORT` - Port to listen on (default: 3000)

**ai-worker only**:
- `WORKER_CONCURRENCY` - Number of concurrent jobs (default: 5)
- `PORT` - Worker health check port (default: 3001)

### 3. Validates Required Variables

The script will fail if these critical variables are missing:
- `DATABASE_URL`
- `QDRANT_URL`
- `GEMINI_API_KEY`
- `DISCORD_TOKEN`

## Safety Features

### 1. Dry-Run Mode

**ALWAYS run with `--dry-run` first!**

```bash
./scripts/setup-railway-variables.sh --dry-run --yes
```

This shows exactly what will be set without making any changes.

### 2. Confirmation Prompt

Without `--yes`, the script prompts for confirmation:

```
⚠  This will set variables in your Railway project
Continue? (yes/no):
```

### 3. Secret Hiding

Sensitive values are never shown in full:
- API keys show as `***set***`
- Tokens show as `***set***`
- Database URLs show as `***set***`

### 4. Validation

The script validates:
- ✅ Railway CLI is installed
- ✅ Project is linked
- ✅ All required variables are provided
- ✅ No empty values for critical vars

## Example Usage

### First Time Setup

```bash
# 1. Make sure you're linked to the right project
railway status

# 2. Preview what will be set
./scripts/setup-railway-variables.sh --dry-run

# 3. Review output carefully - check all values

# 4. Run it for real
./scripts/setup-railway-variables.sh

# 5. Verify
railway variables
railway variables --service bot-client
railway variables --service api-gateway
railway variables --service ai-worker
```

### Updating a Single Variable

If you just need to update one variable:

```bash
# Shared variable (updates all services)
railway variables --set GEMINI_API_KEY="new-key"

# Service-specific variable
railway variables --service bot-client --set DISCORD_TOKEN="new-token"
```

### Verifying Current Configuration

```bash
# View all shared variables
railway variables

# View service-specific variables
railway variables --service bot-client
railway variables --service api-gateway
railway variables --service ai-worker
```

## Troubleshooting

### "Railway CLI is not installed"

```bash
npm install -g @railway/cli
```

### "Not linked to a Railway project"

```bash
railway link
# Then select your project
```

### "Missing required variables: DATABASE_URL"

Add the missing variable to your `.env` file:

```bash
echo 'DATABASE_URL="your-postgres-url"' >> .env
```

Then run the script again.

### Variables Not Taking Effect

After setting variables, you need to redeploy:

```bash
# Railway automatically redeploys when variables change
# But you can force it:
railway up
```

## Manual Configuration (Railway UI)

If you prefer using the Railway dashboard:

1. Go to your project → Variables tab
2. Create a **new variable group** called "Shared"
3. Add shared variables to this group
4. Select each service and add service-specific variables

## What Gets Updated

The script uses Railway's CLI to set:

- **Shared variables**: `railway variables --set KEY=VALUE`
- **Service-specific**: `railway variables --service <name> --set KEY=VALUE`

Railway will automatically:
- ✅ Trigger redeployments for affected services
- ✅ Apply new values on next deployment
- ✅ Keep old values until deployment completes

## Best Practices

1. **Always dry-run first** - Never run blind
2. **Keep .env in sync** - Source of truth for values
3. **Review before confirming** - Check all values in preview
4. **One source of truth** - Use shared variables for common config
5. **Document changes** - Note why you changed a variable
6. **Rotate secrets regularly** - Update API keys periodically

## Security Notes

- ⚠️ Never commit `.env` to git
- ⚠️ Railway variables are encrypted at rest
- ⚠️ Limit who has Railway project access
- ⚠️ Use Railway's secret scanning features
- ⚠️ Rotate compromised credentials immediately

## Advanced: CI/CD Integration

You can use this script in CI/CD:

```yaml
# GitHub Actions example
- name: Setup Railway Variables
  run: |
    ./scripts/setup-railway-variables.sh --yes
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    DISCORD_TOKEN: ${{ secrets.DISCORD_TOKEN }}
    # ... other secrets
```

## Questions?

- **How do I remove a variable?** Use Railway UI or `railway variables --unset KEY`
- **Can I use different values per environment?** Yes, Railway supports multiple environments
- **Do changes take effect immediately?** No, services redeploy with new values
- **Can I rollback?** Yes, redeploy to a previous deployment in Railway UI
