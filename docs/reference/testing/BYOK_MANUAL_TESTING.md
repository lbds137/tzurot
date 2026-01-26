# BYOK Manual Testing Guide

> **Last Updated**: 2025-11-27
> **PR**: Sprint 2-3 BYOK Implementation
> **Purpose**: Comprehensive manual testing checklist for BYOK features

## Prerequisites

### Environment Variables Required

On **both** `api-gateway` and `ai-worker` services:

```bash
# Generate encryption key (run once, use same key for both services)
openssl rand -hex 32

# Set on Railway
railway variables set API_KEY_ENCRYPTION_KEY=<your-64-hex-chars> --service api-gateway
railway variables set API_KEY_ENCRYPTION_KEY=<your-64-hex-chars> --service ai-worker
```

On **both** `api-gateway` and `bot-client` services (for admin commands):

```bash
# Generate admin API key (shared secret for service-to-service auth)
openssl rand -hex 32

# Set on Railway (same key for both services)
railway variables set INTERNAL_SERVICE_SECRET=<your-64-hex-chars> --service api-gateway
railway variables set INTERNAL_SERVICE_SECRET=<your-64-hex-chars> --service bot-client
```

### Verify Setup

```bash
# Check BYOK encryption key is set
railway variables --service api-gateway | grep API_KEY_ENCRYPTION
railway variables --service ai-worker | grep API_KEY_ENCRYPTION

# Check admin API key is set (for admin commands)
railway variables --service api-gateway | grep INTERNAL_SERVICE_SECRET
railway variables --service bot-client | grep INTERNAL_SERVICE_SECRET

# Check services are healthy
curl https://api-gateway-development-83e8.up.railway.app/health
```

---

## Feature Overview

### What Was Implemented

| Category               | Slash Commands                                    | Description                                             |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| **API Keys (BYOK)**    | `/settings apikey set/browse/remove/test`         | Store and manage your own API keys                      |
| **Model Override**     | `/model set/list/reset/set-default/clear-default` | Override which LLM config a personality uses (per-user) |
| **LLM Configs**        | `/llm-config create/list/delete`                  | Create personal model configurations                    |
| **Settings**           | `/settings timezone/usage`                        | User preferences and usage stats                        |
| **Admin (Owner Only)** | `/admin llm-config-create/edit/set-default`       | Manage global LLM configs                               |

### Important Architecture Notes

#### LLM Config Ownership Model

| Config Type    | Created By                 | Visible To | Usable By  |
| -------------- | -------------------------- | ---------- | ---------- |
| **Global**     | `/admin llm-config-create` | Everyone   | Everyone   |
| **User-owned** | `/llm-config create`       | Owner only | Owner only |

**Config Resolution Hierarchy** (first match wins):

1. User per-personality override (`/model set <personality> <config>`)
2. User global default (`/model set-default <config>`)
3. Personality default (assigned by bot owner)
4. System default config (`/admin llm-config-set-default`)

#### Model Override Scope

- `/model set` creates a **per-user** override
- Each user can have different model configs for the same personality
- Overrides are stored in `UserPersonalityConfig` table
- Users can choose from global configs OR their own personal configs

---

## Test Scenarios

### 1. API Key Commands (Core BYOK)

**Commands:**

- `/settings apikey set <provider>` - Opens secure modal for API key entry
- `/settings apikey browse` - Shows stored keys (masked: `sk-or-...xxx`)
- `/settings apikey test <provider>` - Validates key with the provider
- `/settings apikey remove <provider>` - Deletes stored key

**Providers:** `openrouter`, `openai`

#### Test Flow

| Step | Action                               | Expected Result                           |
| ---- | ------------------------------------ | ----------------------------------------- |
| 1.1  | `/settings apikey browse`            | Empty list or "No API keys configured"    |
| 1.2  | `/settings apikey set openrouter`    | Modal opens for key entry                 |
| 1.3  | Enter valid OpenRouter key           | Success message                           |
| 1.4  | `/settings apikey browse`            | Shows `openrouter: sk-or-...xxx` (masked) |
| 1.5  | `/settings apikey test openrouter`   | "Key is valid" message                    |
| 1.6  | Send `@lilith hello`                 | Bot responds                              |
| 1.7  | Check logs                           | Should show `source: 'user'`              |
| 1.8  | `/settings apikey remove openrouter` | Success message                           |
| 1.9  | `/settings apikey browse`            | Empty again                               |
| 1.10 | Send `@lilith hello again`           | Bot responds (using system key)           |
| 1.11 | Check logs                           | Should show `source: 'system'`            |

#### Edge Cases

| Test                | Action                                           | Expected                                      |
| ------------------- | ------------------------------------------------ | --------------------------------------------- |
| Invalid key format  | `/settings apikey set openrouter` with "invalid" | Error: invalid key format                     |
| Invalid key         | `/settings apikey set openrouter` with wrong key | Key stored, but `/settings apikey test` fails |
| Remove non-existent | `/settings apikey remove openai` (never set)     | Error: no key found                           |
| Duplicate set       | `/settings apikey set openrouter` twice          | Second overwrites first                       |

---

### 2. Model Override Commands

**Commands:**

- `/model set <personality> <config>` - Set override for a specific personality
- `/model list` - Show all your model overrides
- `/model reset <personality>` - Remove personality-specific override
- `/model set-default <config>` - Set your global default config (applies to ALL personalities)
- `/model clear-default` - Remove your global default config

#### Test Flow - Per-Personality Override

| Step | Action                            | Expected Result                          |
| ---- | --------------------------------- | ---------------------------------------- |
| 2.1  | `/model list`                     | Empty or "No overrides"                  |
| 2.2  | `/llm-config create` first        | Create a personal config (see section 3) |
| 2.3  | `/model set lilith <your-config>` | Success: "Lilith will now use..."        |
| 2.4  | `/model list`                     | Shows lilith → your-config               |
| 2.5  | Send `@lilith hello`              | Response uses your config's model        |
| 2.6  | `/model reset lilith`             | Success: "Override removed"              |
| 2.7  | `/model list`                     | Empty again                              |

#### Test Flow - User Global Default

| Step | Action                             | Expected Result                      |
| ---- | ---------------------------------- | ------------------------------------ |
| 2.8  | `/model set-default <config>`      | Success: "Default config set"        |
| 2.9  | `/model list`                      | Shows global default in header       |
| 2.10 | Send `@lilith hello`               | Uses your default config             |
| 2.11 | Send `@sarcastic hi`               | Also uses your default config        |
| 2.12 | `/model set lilith <other-config>` | Set personality-specific override    |
| 2.13 | Send `@lilith hello`               | Uses personality override (priority) |
| 2.14 | Send `@sarcastic hi`               | Uses global default (no override)    |
| 2.15 | `/model clear-default`             | Success: "Default config cleared"    |

#### Notes

- Personality selection should show available personalities (autocomplete)
- Config selection shows global configs + your personal configs (autocomplete)
- Override is per-user: other users see default config
- Hierarchy: per-personality > user-global > personality default > system default

---

### 3. LLM Config Commands

**Commands:**

- `/llm-config create <name> <model>` - Create personal config
- `/llm-config list` - Show global + your configs
- `/llm-config delete <config>` - Delete your config (not global)

#### Test Flow

| Step | Action                                                             | Expected Result                             |
| ---- | ------------------------------------------------------------------ | ------------------------------------------- |
| 3.1  | `/llm-config list`                                                 | Shows global configs only                   |
| 3.2  | `/llm-config create name:creative model:anthropic/claude-sonnet-4` | Success                                     |
| 3.3  | `/llm-config list`                                                 | Shows global + "creative" (marked as yours) |
| 3.4  | `/llm-config delete creative`                                      | Success                                     |
| 3.5  | `/llm-config list`                                                 | Only global configs again                   |

#### Edge Cases

| Test           | Action                               | Expected                        |
| -------------- | ------------------------------------ | ------------------------------- |
| Duplicate name | Create "creative" twice              | Error: already exists           |
| Delete global  | Try to delete a global config        | Error: can only delete your own |
| Delete in use  | Delete config that's set as override | Error: in use by X overrides    |
| Long name      | Name > 100 chars                     | Error: too long                 |

---

### 4. Settings Commands

**Commands:**

- `/settings timezone <timezone>` - Set your timezone
- `/settings usage [period]` - View API usage stats

#### Test Flow

| Step | Action                                | Expected Result            |
| ---- | ------------------------------------- | -------------------------- |
| 4.1  | `/settings timezone America/New_York` | Success                    |
| 4.2  | `/settings usage`                     | Shows usage (may be empty) |
| 4.3  | Send several messages with BYOK key   | Messages processed         |
| 4.4  | `/settings usage`                     | Shows token counts         |
| 4.5  | `/settings usage week`                | Shows weekly breakdown     |

#### Valid Timezones

Common examples: `America/New_York`, `America/Los_Angeles`, `Europe/London`, `Asia/Tokyo`, `UTC`

---

### 5. Admin Commands (Owner Only)

**Commands:**

- `/admin llm-config-create <name> <model>` - Create a global LLM config
- `/admin llm-config-edit <config> [name] [model] [...]` - Edit an existing global config
- `/admin llm-config-set-default <config>` - Set a config as the system default

#### Test Flow

| Step | Action                                                                  | Expected Result                   |
| ---- | ----------------------------------------------------------------------- | --------------------------------- |
| 5.1  | `/llm-config list` (as any user)                                        | Shows existing global configs     |
| 5.2  | `/admin llm-config-create name:Claude4 model:anthropic/claude-sonnet-4` | Success: shows new config ID      |
| 5.3  | `/llm-config list` (as any user)                                        | Shows new "Claude4" config        |
| 5.4  | `/admin llm-config-edit config:Claude4 model:anthropic/claude-haiku-4`  | Success: shows updated config     |
| 5.5  | `/admin llm-config-set-default config:Claude4`                          | Success: "Claude4 is now default" |
| 5.6  | Send message without any overrides                                      | Uses Claude4 model                |

#### Notes

- Only the bot owner can run these commands
- Global configs are visible to all users for selection
- Setting a default affects all users who don't have overrides
- Can't delete a config that's set as default or in use
- Config selection uses autocomplete (type to filter)

---

### 6. Infrastructure & Integration Tests

#### 6.1 Encryption Verification

```bash
# After storing a key, verify it's encrypted in DB (not plaintext)
railway run psql -c "SELECT iv, LEFT(content, 20) as content_preview, tag FROM user_api_keys LIMIT 1"
```

Expected: `iv`, `content`, and `tag` columns contain hex/base64 data, NOT your actual API key.

#### 6.2 Cache Invalidation

| Step | Action                    | Expected                                   |
| ---- | ------------------------- | ------------------------------------------ |
| 1    | Store BYOK key            | Key stored                                 |
| 2    | Send message              | Uses user key (check logs)                 |
| 3    | Remove key immediately    | Key removed                                |
| 4    | Send message within 5 min | Should use system key, NOT cached user key |

This tests that cache invalidation via Redis pub/sub is working.

#### 6.3 Usage Logging

```bash
# After sending messages, verify usage is logged
railway run psql -c "SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT 5"
```

Expected: Entries with `user_id`, `provider`, `model`, `tokens_in`, `tokens_out`.

#### 6.4 Fallback Behavior

| Scenario                          | Expected Behavior                    |
| --------------------------------- | ------------------------------------ |
| No BYOK key, system key exists    | Uses system key                      |
| BYOK key exists                   | Uses BYOK key (priority)             |
| No BYOK key, no system key        | Error: "No API key available"        |
| BYOK disabled (no encryption key) | Warning logged, uses system key only |

---

## Log Monitoring Commands

```bash
# Watch ai-worker for key resolution
railway logs --service ai-worker | grep -E "(API key resolved|source)"

# Watch api-gateway for wallet/auth operations
railway logs --service api-gateway | grep -E "(wallet|cache|Auth)"

# Watch bot-client for command execution
railway logs --service bot-client | grep -E "(command|wallet|model|settings)"

# Watch for errors
railway logs --service ai-worker | grep -iE "(error|failed|exception)"
```

---

## Quick Smoke Test (5 minutes)

Run these in order to verify basic functionality:

```
1. /settings apikey browse                          → Empty
2. /settings apikey set openrouter                → Enter your key
3. /settings apikey test openrouter               → Valid
4. @lilith hello                         → Responds
5. /settings usage                       → Shows usage
6. /llm-config create name:test model:anthropic/claude-sonnet-4
7. /llm-config list                      → Shows "test" config
8. /model set lilith test                → Override set
9. @lilith hi again                      → Works with new config
10. /model set-default test              → Global default set
11. @sarcastic hello                     → Also uses test config
12. /model clear-default                 → Global default cleared
13. /model reset lilith                  → Override removed
14. /llm-config delete test              → Config deleted
15. /settings apikey remove openrouter            → Key removed
```

### Admin-Only Smoke Test (Bot Owner)

```
1. /admin llm-config-create name:GlobalTest model:google/gemini-2.0-flash-exp
2. /llm-config list                                → Shows "GlobalTest" as global
3. /admin llm-config-edit config:GlobalTest model:anthropic/claude-sonnet-4
4. /llm-config list                                → Shows updated model
5. /admin llm-config-set-default config:GlobalTest → Set as system default
6. @lilith hello (as normal user)                  → Uses GlobalTest model
```

---

## Known Limitations

1. **No admin commands for BYOK** - Bot owner cannot view/manage other users' keys (by design - security)

2. **Config deletion blocked if in use** - Must remove all overrides using a config before deleting it

3. **No global config deletion via Discord** - Can create, edit, and set default, but deletion requires database access (prevents accidental deletion of configs in use)

---

## Troubleshooting

### "No API key available" Error

- Check `API_KEY_ENCRYPTION_KEY` is set on ai-worker
- Check `OPENROUTER_API_KEY` is set as fallback
- Verify user has stored a key via `/settings apikey browse`

### Key Not Being Used

- Check logs for `source: 'user'` vs `source: 'system'`
- Verify key is active: `/settings apikey browse` should show it
- Test key validity: `/settings apikey test openrouter`

### Cache Issues

- Cache TTL is 5 minutes
- Invalidation should be instant via Redis pub/sub
- Check api-gateway logs for cache invalidation events

### Command Not Found

- Redeploy bot-client to register new commands
- Check `AUTO_DEPLOY_COMMANDS=true` is set
- Try `/help` to see available commands
