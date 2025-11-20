# Complete Feature Flags Reference

This document provides a comprehensive reference for all feature flags available in Tzurot. Feature flags allow you to gradually enable new functionality and control system behavior.

## How Feature Flags Work

### Environment Variable Format

Feature flags are set via environment variables using this format:

```
FEATURE_FLAG_<FLAG_NAME_IN_UPPERCASE>=true|false
```

For example, the flag `ddd.commands.utility` becomes:

```bash
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
```

### Dots and Hyphens

- Dots (`.`) become underscores (`_`)
- Hyphens (`-`) become underscores (`_`)

Example: `ddd.events.cache-invalidation` → `FEATURE_FLAG_DDD_EVENTS_CACHE_INVALIDATION`

### Default Values

All flags have default values defined in the code. Most new features default to `false` (disabled) for safety.

---

## 🏗️ DDD Migration Flags

These flags control the gradual migration from legacy systems to the new Domain-Driven Design (DDD) architecture.

### Core Domain Migration

```bash
# Personality system migration
FEATURE_FLAG_DDD_PERSONALITY_READ=false        # Use DDD for reading personality data
FEATURE_FLAG_DDD_PERSONALITY_WRITE=false       # Use DDD for writing personality data
FEATURE_FLAG_DDD_PERSONALITY_DUAL_WRITE=false  # Write to both legacy and DDD systems

# Conversation system migration
FEATURE_FLAG_DDD_CONVERSATION_READ=false       # Use DDD for reading conversation data
FEATURE_FLAG_DDD_CONVERSATION_WRITE=false      # Use DDD for writing conversation data

# Authentication system migration
FEATURE_FLAG_DDD_AUTHENTICATION_READ=false     # Use DDD for reading auth data
FEATURE_FLAG_DDD_AUTHENTICATION_WRITE=false    # Use DDD for writing auth data

# AI service migration
FEATURE_FLAG_DDD_AI_READ=false                 # Use DDD for AI service reads
FEATURE_FLAG_DDD_AI_WRITE=false                # Use DDD for AI service writes
```

**Migration Strategy**: Enable `read` flags first, then `write` flags, then remove legacy code.

---

## 🎛️ DDD Events System

Controls the domain event system for real-time updates and system integration.

```bash
FEATURE_FLAG_DDD_EVENTS_ENABLED=false                    # Enable domain events
FEATURE_FLAG_DDD_EVENTS_LOGGING=true                     # Log domain events (default: enabled)
FEATURE_FLAG_DDD_EVENTS_CACHE_INVALIDATION=true          # Use events for cache invalidation (default: enabled)
```

**Use Cases**:

- `ddd.events.enabled`: Master switch for event system
- `ddd.events.logging`: Debug event flow (safe to keep enabled)
- `ddd.events.cache-invalidation`: Automatic cache updates when data changes

---

## ⚡ DDD Commands System

Controls which commands use the new DDD command system vs. legacy handlers.

### Global Command Flags

```bash
FEATURE_FLAG_DDD_COMMANDS_ENABLED=false                  # Master switch for DDD commands
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=false              # Enable CommandIntegration routing
FEATURE_FLAG_DDD_COMMANDS_FALLBACKONERROR=true           # Fallback to legacy on DDD errors (default: enabled)
FEATURE_FLAG_DDD_COMMANDS_SLASH=false                    # Enable Discord slash commands
```

### Command Category Flags

```bash
# Utility commands: ping, status, debug, help, purgbot, volumetest, notifications
FEATURE_FLAG_DDD_COMMANDS_UTILITY=false

# Personality commands: add, remove, info, alias, list
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=false

# Conversation commands: activate, deactivate, reset, autorespond
FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=false

# Authentication commands: auth, verify
FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=false
```

**Command Categories Explained**:

- **Utility**: Safe, read-only commands ideal for initial testing
- **Personality**: Commands that modify personality data (test carefully)
- **Conversation**: Commands that affect active conversations
- **Authentication**: Security-sensitive commands (enable last)

**Recommended Enablement Order**:

1. Set `FEATURE_FLAG_DDD_COMMANDS_ENABLED=true`
2. Set `FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true`
3. Enable categories one at a time: `utility` → `personality` → `conversation` → `authentication`

---

## 📝 General Command System

Controls the overall command system behavior.

```bash
FEATURE_FLAG_COMMANDS_SLASH_ENABLED=false                # Enable Discord slash commands globally
FEATURE_FLAG_COMMANDS_TEXT_ENABLED=true                  # Enable text commands (default: enabled)
FEATURE_FLAG_COMMANDS_PLATFORM_AGNOSTIC=false            # Platform-agnostic command handling
```

**Notes**:

- `commands.text.enabled`: Should stay `true` unless fully migrating to slash commands
- `commands.platform-agnostic`: Experimental feature for multi-platform support

---

## 🚀 General Features

Controls experimental and optional features.

```bash
# Testing and development features
FEATURE_FLAG_FEATURES_COMPARISON_TESTING=false           # A/B testing between legacy and DDD systems
FEATURE_FLAG_FEATURES_PERFORMANCE_LOGGING=false          # Detailed performance metrics logging

# External service features
FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT=false             # Send enhanced context to AI services
```

**Feature Descriptions**:

- `features.comparison-testing`: Runs both legacy and DDD systems in parallel for comparison
- `features.performance-logging`: Adds detailed timing logs (may impact performance)
- `features.enhanced-context`: Sends additional context to AI services (may increase API costs)

---

## 🛠️ Common Configuration Scenarios

### Development Environment

```bash
# Safe development testing
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
FEATURE_FLAG_DDD_COMMANDS_FALLBACKONERROR=true
FEATURE_FLAG_DDD_EVENTS_LOGGING=true
```

### Production Gradual Rollout

```bash
# Week 1: Utility commands only
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
FEATURE_FLAG_DDD_COMMANDS_FALLBACKONERROR=true

# Week 2: Add personality commands
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true

# Week 3: Add conversation commands
FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=true

# Week 4: Add authentication (most sensitive)
FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=true
```

### Full DDD Migration

```bash
# All DDD systems enabled
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true
FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=true
FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=true
FEATURE_FLAG_DDD_EVENTS_ENABLED=true
FEATURE_FLAG_DDD_PERSONALITY_READ=true
FEATURE_FLAG_DDD_PERSONALITY_WRITE=true
FEATURE_FLAG_DDD_CONVERSATION_READ=true
FEATURE_FLAG_DDD_CONVERSATION_WRITE=true
FEATURE_FLAG_DDD_AUTHENTICATION_READ=true
FEATURE_FLAG_DDD_AUTHENTICATION_WRITE=true
```

---

## 🔍 Monitoring and Debugging

### Key Log Messages

When changing feature flags, watch for these log messages:

```
[CommandIntegrationAdapter] Processing command "X" using new system
[CommandIntegrationAdapter] Processing command "X" using legacy system
[CommandIntegrationAdapter] Falling back to legacy system due to error
Unknown feature flag: flag-name  # Indicates typo in environment variable
```

### Testing Your Configuration

You can test your feature flag configuration:

```bash
# Check if a specific flag is enabled
node -e "console.log(require('./src/application/services/FeatureFlags').getFeatureFlags().isEnabled('ddd.commands.utility'))"

# List all enabled flags
node -e "const flags = require('./src/application/services/FeatureFlags').getFeatureFlags().getAllFlags(); Object.entries(flags).filter(([k,v]) => v).forEach(([k,v]) => console.log(k, '=', v))"
```

---

## ⚠️ Important Notes

### Safety Guidelines

1. **Always enable fallback first**: Set `FEATURE_FLAG_DDD_COMMANDS_FALLBACKONERROR=true`
2. **Test in development**: Never enable new flags directly in production
3. **Monitor closely**: Watch logs and error rates when enabling new flags
4. **Enable gradually**: One category at a time, not all at once

### Environment File Example

Your `.env` file might look like:

```bash
# Discord bot token
DISCORD_TOKEN=your_token_here

# Feature flags for DDD command system
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
FEATURE_FLAG_DDD_COMMANDS_FALLBACKONERROR=true

# Other configuration...
```

### Troubleshooting

- **"Unknown feature flag" warnings**: Check your environment variable spelling
- **Commands not using DDD**: Ensure both `enabled` and `integration` flags are true
- **Commands failing**: Check if fallback is enabled and review error logs

---

## 📚 Related Documentation

- [DDD Enablement Guide](../ddd/DDD_ENABLEMENT_GUIDE.md) - Step-by-step migration guide
- [DDD Architecture Overview](../architecture/ARCHITECTURE_OVERVIEW_2025-06-18.md) - Technical overview
- [Production Deployment Guide](../deployment/PRODUCTION_DEPLOYMENT_RUNBOOK.md) - Production considerations

---

_Last updated: 2025-06-19_  
_For questions about feature flags, check the source code in `src/application/services/FeatureFlags.js`_
