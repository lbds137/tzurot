# Environment Variable Cleanup

## Overview

This document describes the environment variable cleanup performed to simplify configuration across development and production environments.

## Changes Made

### 1. Unified Variable Names

Instead of using different variable names for different environments (e.g., `DISCORD_DEV_TOKEN` vs `DISCORD_TOKEN`), we now use the same variable names and set them to different values in each environment.

### 2. Standardized Naming

- Consolidated `OWNER_ID` and `BOT_OWNER_ID` to just `BOT_OWNER_ID`
- All bot-specific variables now start with `BOT_` prefix

### 3. Removed Hardcoded URLs

- Removed hardcoded Railway URLs from config.js
- Now relies entirely on `BOT_PUBLIC_BASE_URL` environment variable

## Migration Guide

### For Development Environment

Set these in your development `.env` or Railway development service:

```bash
NODE_ENV=development
DISCORD_TOKEN=your_dev_bot_token
BOT_NAME=Rotzot
BOT_PREFIX=!rtz
BOT_MENTION_CHAR=&
BOT_PUBLIC_BASE_URL=https://tzurot-development.up.railway.app
```

### For Production Environment

Set these in your production `.env` or Railway production service:

```bash
NODE_ENV=production
DISCORD_TOKEN=your_prod_bot_token
BOT_NAME=Tzurot
BOT_PREFIX=!tz
BOT_MENTION_CHAR=@
BOT_PUBLIC_BASE_URL=https://tzurot-production.up.railway.app
```

### Deprecated Variables

The following variables are no longer used:
- `DISCORD_DEV_TOKEN` - Use `DISCORD_TOKEN` instead
- `OWNER_ID` - Use `BOT_OWNER_ID` instead
- `OWNER_PERSONALITIES` - Use `BOT_OWNER_PERSONALITIES` instead

### Complete Variable List

See `.env.example` for the complete list of environment variables with descriptions.

## Benefits

1. **Simpler configuration** - One set of variable names for all environments
2. **Easier deployment** - No code changes needed when deploying to different environments
3. **Better documentation** - Clear `.env.example` file shows all required variables
4. **More flexible** - Can easily add new environments without code changes

## Implementation Notes

- The config.js file still supports the old variables as fallbacks for backward compatibility
- The NODE_ENV variable determines which defaults to use if specific variables aren't set
- All environment-specific logic is now configuration-driven rather than hardcoded