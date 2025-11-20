# DDD Command System Deployment Guide

This guide explains how to enable the new Domain-Driven Design (DDD) command system in production.

## 🚀 Quick Start

### Option 1: Enable All DDD Features (Recommended for Testing)

```bash
# Copy the pre-configured DDD testing environment
cp .env.ddd-testing .env

# Restart the bot
npm run dev  # or your production start command
```

### Option 2: Gradual Rollout (Recommended for Production)

Add these environment variables to your `.env` file:

```bash
# Enable DDD command routing
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true

# Enable personality commands (all or individual)
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true

# Or enable individual commands:
# FEATURE_FLAG_DDD_COMMANDS_ADD=true
# FEATURE_FLAG_DDD_COMMANDS_REMOVE=true
# FEATURE_FLAG_DDD_COMMANDS_INFO=true
# FEATURE_FLAG_DDD_COMMANDS_ALIAS=true
# FEATURE_FLAG_DDD_COMMANDS_LIST=true
# FEATURE_FLAG_DDD_COMMANDS_RESET=true

# Enable DDD personality system
FEATURE_FLAG_DDD_PERSONALITY_READ=true
FEATURE_FLAG_DDD_PERSONALITY_WRITE=true

# Optional: Enable dual-write for extra safety
FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=true
```

## 📋 Feature Flags Explained

### Core Command System Flags

- `FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true`
  - **Required**: Enables the CommandIntegration routing system
  - Without this, all commands use the legacy system

- `FEATURE_FLAG_DDD_COMMANDS_ENABLED=true`
  - **Required**: Enables DDD commands globally
  - Acts as a master switch for all DDD commands

- `FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true`
  - Enables all personality-related commands at once
  - Covers: add, remove, info, alias, list, reset

### Individual Command Flags

You can enable commands one at a time for gradual rollout:

- `FEATURE_FLAG_DDD_COMMANDS_ADD=true` - /add command
- `FEATURE_FLAG_DDD_COMMANDS_REMOVE=true` - /remove command
- `FEATURE_FLAG_DDD_COMMANDS_INFO=true` - /info command
- `FEATURE_FLAG_DDD_COMMANDS_ALIAS=true` - /alias command
- `FEATURE_FLAG_DDD_COMMANDS_LIST=true` - /list command
- `FEATURE_FLAG_DDD_COMMANDS_RESET=true` - /reset command

### System Flags

- `FEATURE_FLAG_DDD_PERSONALITY_READ=true`
  - Routes personality reads through DDD system
  - Required for DDD commands to work properly

- `FEATURE_FLAG_DDD_PERSONALITY_WRITE=true`
  - Routes personality writes through DDD system
  - Required for add/remove/alias commands

- `FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=true`
  - **Safety Feature**: Writes to both legacy and DDD systems
  - Ensures data consistency during migration
  - Can be disabled once you trust the DDD system

### Event System Flags

- `FEATURE_FLAG_DDD_EVENTS_ENABLED=true`
  - Enables domain event system
  - Required for cache invalidation and logging

- `FEATURE_FLAG_DDD_EVENTS_CACHE_INVALIDATION=true`
  - Automatically clears caches when personalities change
  - Keeps legacy and DDD systems in sync

## 🧪 Testing Your Deployment

### 1. Verify Feature Flags

Run the test script to check your configuration:

```bash
node scripts/test-ddd-commands.js
```

You should see:

- ✅ All feature flags enabled
- ✅ 6 commands registered
- ✅ Command lookup working

### 2. Test Commands In Discord

Try these commands in order:

```bash
!tz list                    # List your personalities
!tz add TestBot             # Add a test personality
!tz info TestBot            # Check it was created
!tz alias TestBot testy     # Add an alias
!tz list                    # Verify it appears
!tz reset TestBot           # Reset conversation
!tz remove TestBot          # Clean up
```

### 3. Monitor Logs

Watch for these log messages:

```
[CommandIntegrationAdapter] Processing command "add" using new system
[AddCommand] Creating personality "TestBot" for user 123456789
[PersonalityApplicationService] Personality created successfully
```

## 🔄 Rollback Plan

If issues occur, you can instantly rollback:

### Option 1: Disable All DDD Commands

```bash
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=false
```

### Option 2: Disable Specific Commands

```bash
# Keep some commands on DDD, rollback others
FEATURE_FLAG_DDD_COMMANDS_ADD=false  # Use legacy /add
FEATURE_FLAG_DDD_COMMANDS_LIST=true  # Keep DDD /list
```

### Option 3: Emergency Full Rollback

Remove all `FEATURE_FLAG_DDD_*` entries from `.env` and restart.

## 📊 Monitoring

### What to Watch

1. **Command Success Rate**
   - DDD commands log extensively
   - Watch for any increase in errors

2. **Performance**
   - DDD commands should perform similarly to legacy
   - Monitor response times

3. **Data Consistency**
   - With dual-write enabled, both systems stay in sync
   - Verify personalities appear in both `/list` outputs

### Useful Log Searches

```bash
# Check which system is handling commands
grep "using new system" logs/bot.log
grep "using legacy system" logs/bot.log

# Monitor for errors
grep "CommandIntegrationAdapter.*Error" logs/bot.log

# Track dual-write operations
grep "dual-write" logs/bot.log
```

## 🎯 Deployment Strategies

### Conservative Approach (Recommended)

Week 1:

- Enable read operations only
- `FEATURE_FLAG_DDD_PERSONALITY_READ=true`
- `FEATURE_FLAG_DDD_COMMANDS_LIST=true`
- `FEATURE_FLAG_DDD_COMMANDS_INFO=true`

Week 2:

- Enable write operations with dual-write
- `FEATURE_FLAG_DDD_PERSONALITY_WRITE=true`
- `FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=true`
- Enable remaining commands

Week 3:

- Disable dual-write after verification
- `FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=false`

### Aggressive Approach (If Confident)

Enable everything at once by copying `.env.ddd-testing` to `.env`.

## 🆘 Troubleshooting

### Commands Not Using DDD System

Check:

1. `FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true` is set
2. Bot was restarted after changing `.env`
3. No typos in environment variable names

### "PersonalityApplicationService not available" Error

Ensure these are set:

- `AI_SERVICE_URL` (your AI service endpoint)
- `AI_SERVICE_API_KEY` (your API key)

### Data Not Syncing

Enable dual-write:

- `FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=true`

## 📝 Post-Deployment

Once stable:

1. Update documentation to reflect DDD as primary system
2. Plan legacy system removal (Phase 4)
3. Disable dual-write to improve performance
4. Celebrate! 🎉

## 🔗 Related Documentation

- [DDD Phase 3 Progress](./DDD_PHASE_3_PROGRESS.md)
- [Command System Architecture](../core/COMMAND_SYSTEM.md)
- [Feature Flags Guide](../development/FEATURE_FLAGS.md)
