# Railway Shared Variables Setup

This guide explains how to use the automated script to set up shared and service-specific environment variables in Railway.

## Quick Start

### Using pnpm ops (Recommended)

```bash
# Preview what will be set (dry run)
pnpm ops deploy:setup-vars --env dev --dry-run

# Set variables in development environment
pnpm ops deploy:setup-vars --env dev

# Set variables in production environment
pnpm ops deploy:setup-vars --env prod
```

The command reads from your local `.env` file and sets variables in Railway.

**Options:**

- `--env dev|prod` - Target environment (default: dev)
- `--dry-run` - Show what would be set without making changes
- `--yes, -y` - Skip confirmation prompts

### Using Railway Dashboard (Alternative)

1. Go to Railway project → **Project Settings** → **Shared Variables**
2. Add shared variables (see list below)
3. Click **"Share"** button for each variable and select all services
4. Set service-specific variables in each service's Variables tab
5. Add database reference: `DATABASE_URL=${{Postgres.DATABASE_URL}}`

See **"Setting Up Shared Variables in Dashboard"** section below for detailed steps.

## Command Options

| Option        | Description                                            |
| ------------- | ------------------------------------------------------ |
| `--env <env>` | Target environment: `dev` or `prod` (default: `dev`)   |
| `--dry-run`   | Show what would be set without actually making changes |
| `--yes`, `-y` | Skip confirmation prompts (for CI/CD)                  |

## How It Works

### 1. Reads from Your .env File

The script automatically reads your current `.env` file and uses those values. This means:

- ✅ No need to re-enter values you already have
- ✅ Consistent with your local development setup
- ✅ Secrets are hidden in output (**_set_**)

### 2. Categorizes Variables

The script sets variables in three categories:

**Shared (all services)**:

- `DATABASE_URL` - PostgreSQL connection (see Database URL Strategy below)
- `REDIS_URL` - Redis connection (Railway addon provides this automatically)
- `AI_PROVIDER` - Which AI provider to use
- `OPENROUTER_API_KEY` - OpenRouter API key
- `OPENAI_API_KEY` - OpenAI API key (for embeddings and Whisper transcription)
- `DEFAULT_AI_MODEL` - Default model
- `WHISPER_MODEL` - Audio transcription (OpenAI API: `whisper-1`)
- `VISION_FALLBACK_MODEL` - Image analysis
- `EMBEDDING_MODEL` - Vector embeddings
- `NODE_ENV` - Environment (production/development)
- `LOG_LEVEL` - Logging verbosity

**Note on Memory**: RAG memory uses pgvector extension in PostgreSQL. No separate vector database needed.

**bot-client only**:

- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Discord application ID

**api-gateway only**:

- `API_GATEWAY_PORT` - Port to listen on (default: 3000)

**ai-worker only**:

- `WORKER_CONCURRENCY` - Number of concurrent jobs (default: 5)
- `PORT` - Worker health check port (default: 3001)

### 3. Database URL Strategy

Railway provides **two types** of PostgreSQL connection URLs:

#### DATABASE_URL (Private Network)

- **Location**: `<service>.railway.internal:5432`
- **Use for**: Service-to-service communication within Railway
- **Benefits**:
  - ✅ Faster (no proxy overhead)
  - ✅ No network egress charges
  - ✅ More secure (never leaves Railway's network)
- **Limitations**: Only works within Railway infrastructure

#### DATABASE_PUBLIC_URL (TCP Proxy)

- **Location**: `<region>.proxy.rlwy.net:<port>`
- **Use for**: External access (local development, database IDEs, debugging)
- **Benefits**:
  - ✅ Access from anywhere (your IDE, local machine)
  - ✅ SSL/TLS encryption by default
  - ✅ Password authentication required
- **Limitations**:
  - ⚠️ Network egress charges apply
  - ⚠️ No IP whitelisting (Railway limitation)

#### Security Assessment

**TCP Proxy is safe for external access because**:

1. **SSL/TLS Encryption**: All connections encrypted by default
2. **Authentication Required**: Strong password must be provided
3. **Railway's Infrastructure**: Managed and monitored by Railway
4. **No Different Than Cloud DBs**: Same security model as AWS RDS, GCP Cloud SQL

**The main security consideration** is credential management:

- Keep credentials out of version control
- Use strong, unique passwords
- Rotate credentials if compromised
- Limit who has Railway project access

#### Recommended Setup

**For Production Services (running on Railway)**:

```bash
# Use private network URL (Railway provides this automatically)
DATABASE_URL="${{Postgres.DATABASE_URL}}"
```

**For Development/Local Access**:

```bash
# In your local .env, use the TCP proxy URL
DATABASE_URL="postgresql://user:pass@region.proxy.rlwy.net:port/db"
```

**For JetBrains IDE / Database Tools**:

- Enable TCP Proxy in Railway dashboard (Settings → Networking)
- Use `DATABASE_PUBLIC_URL` from Railway variables
- Configure SSL mode to "require" in your IDE connection settings

### 4. Validates Required Variables

The script will fail if these critical variables are missing:

- `DATABASE_URL`
- `OPENROUTER_API_KEY` (or `OPENAI_API_KEY` for embeddings)
- `DISCORD_TOKEN`

## Safety Features

### 1. Dry-Run Mode

**ALWAYS run with `--dry-run` first!**

```bash
pnpm ops deploy:setup-vars --env dev --dry-run
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
pnpm ops deploy:setup-vars --env dev --dry-run

# 3. Review output carefully - check all values

# 4. Run it for real
pnpm ops deploy:setup-vars --env dev

# 5. Verify
railway variables --environment development
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

## Setting Up Shared Variables in Dashboard

### Step 1: Create Shared Variables

1. Go to Railway project dashboard
2. Click **"Project Settings"** (gear icon in top right)
3. Navigate to **"Shared Variables"** tab on left sidebar
4. Select **"development"** environment from dropdown
5. For each variable below, click **"Add Variable"** and enter:

**Shared Variables to Add**:

```
DATABASE_URL=<Railway PostgreSQL URL - includes pgvector>
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=<your-openrouter-key>
OPENAI_API_KEY=<your-openai-key>  # For Whisper transcription only
DEFAULT_AI_MODEL=anthropic/claude-haiku-4.5
WHISPER_MODEL=whisper-1
VISION_FALLBACK_MODEL=qwen/qwen3-vl-235b-a22b-instruct
# Note: Embeddings are local (no API key needed)
NODE_ENV=development
LOG_LEVEL=debug
```

### Step 2: Share Variables with Services

After adding each variable:

1. Click the **"Share"** button next to the variable
2. Select all three services:
   - ☑️ api-gateway
   - ☑️ ai-worker
   - ☑️ bot-client
3. Click **"Share"**

**Alternative**: Go to each service's **Variables** tab → Click **"Add Shared Variable"** → Select the variables to add.

### Step 3: Set Database URL Reference

For **api-gateway** and **ai-worker** (services that need database):

1. Go to service's **Variables** tab
2. Click **"Add Variable"**
3. Set:
   - Name: `DATABASE_URL`
   - Value: `${{Postgres.DATABASE_URL}}`
4. Click **"Add"**

**Note**: bot-client doesn't need database access (HTTP-only client).

### Step 4: Set Service-Specific Variables

**bot-client**:

```
DISCORD_TOKEN=<your-discord-token>
DISCORD_CLIENT_ID=<your-client-id>
```

**api-gateway**:

```
PORT=3000
```

**ai-worker**:

```
WORKER_CONCURRENCY=5
PORT=3001
```

### Step 5: Verify Setup

Check each service's Variables tab. You should see:

- 📦 **Shared variables** (marked with a shared icon/badge)
- 🔗 **Reference variable** (`DATABASE_URL=${{Postgres.DATABASE_URL}}`)
- 🔧 **Service-specific variables**

Railway will automatically trigger redeployments when variables are added/changed.

---

## Syncing Variables to Production

Once you have shared variables set up in development, you can sync them to production using Railway's **Environment Sync** feature.

### How to Sync Environments

1. Go to Railway dashboard
2. Switch to your **production** environment (use dropdown at top)
3. Click the **"Sync"** button (usually near the environment name)
4. Select **development** as the source environment
5. Review the diff showing what will change:
   - 🟢 **New variables** being added
   - 🟡 **Modified variables** with value changes
   - 🔴 **Removed variables** being deleted
   - 📦 **Shared variables** are included in sync
6. Click **"Sync"** to apply changes

### What Gets Synced

✅ **Shared variables** (including new ones you add)
✅ **Service-specific variables**
✅ **Service configurations**
✅ **Reference variables** (like `${{Postgres.DATABASE_URL}}`)

❌ **Sealed variables** are NOT shown in the diff (for security)

### Best Practices for Environment Sync

1. **Always review the diff** before syncing - don't blindly apply changes
2. **Adjust production-specific values** after sync:
   - Change `NODE_ENV=production`
   - Change `LOG_LEVEL=info` (less verbose than `debug`)
   - Update any dev-specific URLs/credentials
3. **Test in development first** before syncing to production
4. **Sync regularly** to keep environments in sync
5. **Use sealed variables** for production secrets that shouldn't be synced

### Alternative: Manual Setup

If you prefer not to use sync, you can manually set up production:

1. Switch to production environment
2. Go to Project Settings → Shared Variables
3. Add the same variables as development
4. Adjust values for production (NODE_ENV, LOG_LEVEL, etc.)
5. Share with services
6. Add service-specific variables

---

## Enabling/Disabling Database Public Access

### To Enable TCP Proxy (for IDE/external access)

1. **Via Railway Dashboard**:
   - Go to your Postgres service
   - Navigate to **Settings** → **Networking**
   - Enable **TCP Proxy**
   - Railway will generate `DATABASE_PUBLIC_URL`

2. **Use the Public URL**:

   ```bash
   # Get the public URL
   railway variables | grep DATABASE_PUBLIC_URL

   # Use it in your JetBrains IDE connection settings
   # Host: region.proxy.rlwy.net
   # Port: (from the URL)
   # Database: railway
   # User: postgres
   # Password: (from the URL)
   # SSL: Require
   ```

### To Disable TCP Proxy (production security)

If you want to lock down production databases:

1. **Via Railway Dashboard**:
   - Go to your Postgres service
   - Navigate to **Settings** → **Networking**
   - Disable **TCP Proxy**
   - `DATABASE_PUBLIC_URL` will be removed

2. **For Production Environment Only**:
   - Railway supports multiple environments
   - Keep TCP proxy **enabled for development**
   - Keep TCP proxy **disabled for production**
   - This way you can still debug in dev, but prod is locked down

### Current Recommendation

**Development Environment**:

- ✅ **Keep TCP Proxy enabled** - You need IDE access for debugging, schema inspection, and manual testing
- ✅ Use strong password (Railway generates good defaults)
- ✅ SSL/TLS is enabled by default
- ✅ This is the standard way to access Railway databases externally

**Production Environment**:

- ✅ **Keep TCP Proxy enabled** - You'll want IDE access for production debugging too
- ✅ **Use different credentials** than development (Railway generates separate DB per environment)
- ✅ **Limit Railway project access** - Only trusted collaborators should see database credentials
- ✅ **Monitor access** - Railway tracks who views variables in dashboard

**Security Considerations**:

- **Small hobby project**: TCP proxy with strong passwords + SSL is sufficient
- **Growing project**: Same approach works, just ensure credentials aren't shared publicly
- **Large-scale/enterprise**: Consider additional layers:
  - IP whitelisting (via VPN or bastion host, Railway doesn't provide native IP whitelisting)
  - Read-only replicas for analytics
  - Separate analytics database
  - Database audit logging

**Current Status**:

- Both development and production environments exist and are ready
- v3 not yet deployed to production (still in development testing)
- Private testing only (no public users)
- TCP proxy is safe and practical for your current needs
- When you go public, same security model still works (Railway's standard approach)

## Best Practices

1. **Always dry-run first** - Never run blind
2. **Keep .env in sync** - Source of truth for values
3. **Review before confirming** - Check all values in preview
4. **One source of truth** - Use shared variables for common config
5. **Document changes** - Note why you changed a variable
6. **Rotate secrets regularly** - Update API keys periodically
7. **Use private URLs in production** - Services should use `DATABASE_PRIVATE_URL`
8. **Use public URLs locally** - Your local dev needs TCP proxy access
9. **Keep production locked down** - Disable TCP proxy for production environment

## Security Notes

- ⚠️ Never commit `.env` to git
- ⚠️ Railway variables are encrypted at rest
- ⚠️ Limit who has Railway project access
- ⚠️ Use Railway's secret scanning features
- ⚠️ Rotate compromised credentials immediately

## Advanced: CI/CD Integration

You can use this command in CI/CD:

```yaml
# GitHub Actions example
- name: Setup Railway Variables
  run: pnpm ops deploy:setup-vars --env dev --yes
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    DISCORD_TOKEN: ${{ secrets.DISCORD_TOKEN }}
    # ... other secrets from .env
```

## Connecting JetBrains IDE to Railway Database

### Quick Setup

**Works for both development and production databases** - just switch Railway environments first.

1. **Get your database public URL**:

   ```bash
   # For development
   railway environment development
   railway variables | grep DATABASE_PUBLIC_URL

   # For production
   railway environment production
   railway variables | grep DATABASE_PUBLIC_URL

   # Or from Railway dashboard: Postgres service → Connect → Public URL
   ```

2. **In JetBrains IDE (WebStorm, IntelliJ, etc.)**:
   - Open **Database** tool window (View → Tool Windows → Database)
   - Click **+** → **Data Source** → **PostgreSQL**
   - Enter connection details:
     - **Host**: `region.proxy.rlwy.net` (from your URL)
     - **Port**: `xxxxx` (from your URL)
     - **Database**: `railway`
     - **User**: `postgres`
     - **Password**: (from your URL)
   - Click **Test Connection**
   - If successful, click **OK**

3. **Security Settings** (recommended):
   - In the connection dialog, go to **SSH/SSL** tab
   - Set **Use SSL**: **require**
   - Click **OK**

4. **Managing Multiple Environments**:
   - Create separate connections for dev and prod
   - Name them clearly: "Tzurot Dev" and "Tzurot Prod"
   - Use different colors for each (right-click connection → Color settings)
   - **Pro tip**: Make production RED to avoid accidental changes

### Troubleshooting

**"Could not connect to server"**:

- Verify TCP Proxy is enabled in Railway dashboard
- Check your internet connection
- Confirm credentials are correct

**"SSL connection required"**:

- Enable SSL in connection settings (see step 3 above)

**"Too many connections"**:

- Close unused database connections in your IDE
- Check other services aren't using too many connections

### Security Reminder

✅ **Safe for hobby-to-production projects**:

- SSL/TLS encryption is automatic
- Strong password authentication (Railway generates secure defaults)
- Standard cloud database security model (same as AWS RDS, GCP Cloud SQL)
- Railway tracks who accesses credentials in dashboard

⚠️ **Keep credentials secure**:

- ✅ Don't commit database URLs to git (use .env.example with placeholders)
- ✅ Don't share credentials in public channels (Discord, Slack, etc.)
- ✅ Use Railway's team access controls to limit who can view variables
- ✅ Use different passwords for dev and prod databases
- ✅ In JetBrains IDE, color-code production connection RED to avoid accidents

**Scaling Security**:

- **Current**: TCP proxy + SSL + strong passwords is sufficient
- **Growing**: Same approach, just limit Railway project access to trusted people
- **Enterprise**: Add bastion hosts, VPNs, IP whitelisting, read replicas

## Questions?

- **How do I remove a variable?** Use Railway UI or `railway variables --unset KEY`
- **Can I use different values per environment?** Yes, Railway supports multiple environments
- **Do changes take effect immediately?** No, services redeploy with new values
- **Can I rollback?** Yes, redeploy to a previous deployment in Railway UI
- **Is it safe to access my database from my IDE?** Yes, see "Connecting JetBrains IDE to Railway Database" above
