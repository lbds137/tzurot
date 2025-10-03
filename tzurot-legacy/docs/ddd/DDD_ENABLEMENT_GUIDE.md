# DDD Feature Enablement Guide

## Overview

The DDD system is fully built and tested but **NOT ACTIVE**. This guide explains how to enable it safely.

## Current State (June 18, 2025)

- ✅ All 18 commands migrated to DDD
- ✅ CommandIntegrationAdapter wired and initialized
- ✅ All tests passing (245 suites, 4283 tests)
- ❌ All feature flags disabled (legacy system handles 100% of traffic)

## Feature Flag Reference

### Global Flags
```bash
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true      # Enable DDD command system
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true  # Enable routing to DDD
FEATURE_FLAG_DDD_EVENTS_ENABLED=true        # Enable domain events
```

### Category Flags
```bash
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true       # ping, help, status, debug, etc.
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true   # add, remove, info, alias, list
FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=true  # activate, deactivate, autorespond
FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=true # auth, verify
```

### Safety Flags
```bash
FEATURE_FLAG_DDD_COMMANDS_FALLBACK_ON_ERROR=true  # Fallback to legacy on error
```

## Recommended Enablement Strategy

### Phase 1: Development Testing (Week 1)
Enable in development environment first:

```bash
# .env.development
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true  # Start with safe commands
FEATURE_FLAG_DDD_COMMANDS_FALLBACK_ON_ERROR=true
```

Test thoroughly:
- Run `!tz ping`, `!tz help`, `!tz status`
- Check logs for routing decisions
- Verify responses match legacy

### Phase 2: Gradual Production Rollout (Week 2-3)

#### Day 1-2: Utility Commands
```bash
# Enable only utility commands
FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true
FEATURE_FLAG_DDD_COMMANDS_UTILITY=true
```

Monitor:
- Error rates
- Response times
- User feedback

#### Day 3-5: Personality Commands
```bash
# Add personality commands
FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true
```

Test:
- `!tz add`, `!tz remove`, `!tz list`
- Verify data persistence
- Check webhook creation

#### Day 6-7: Conversation Commands
```bash
# Add conversation commands
FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=true
```

#### Day 8-9: Authentication Commands
```bash
# Add auth commands (most sensitive)
FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=true
```

### Phase 3: Full Cutover (Week 4)

1. **Disable Fallback**:
   ```bash
   FEATURE_FLAG_DDD_COMMANDS_FALLBACK_ON_ERROR=false
   ```

2. **Enable Events**:
   ```bash
   FEATURE_FLAG_DDD_EVENTS_ENABLED=true
   ```

3. **Monitor for 48 hours**

4. **Remove Legacy Code** (if stable)

## Monitoring During Rollout

### Key Log Messages to Watch

```
[CommandIntegrationAdapter] Processing command "X" using new system
[CommandIntegrationAdapter] Routing to legacy system: X
[CommandIntegrationAdapter] New system error: X
[CommandIntegrationAdapter] Falling back to legacy system due to error
```

### Metrics to Track

1. **Error Rates**
   - DDD system errors vs legacy
   - Fallback frequency

2. **Performance**
   - Command response times
   - Memory usage changes

3. **Functionality**
   - All commands working as expected
   - Data persistence correct
   - Webhook operations normal

## Rollback Procedure

If issues arise at any stage:

1. **Immediate Rollback** (< 1 minute):
   ```bash
   # Set all DDD flags to false
   FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=false
   ```

2. **Restart Bot**:
   ```bash
   # Your deployment restart command
   ```

3. **Investigate**:
   - Check logs for errors
   - Review monitoring metrics
   - Fix issues before retry

## Testing Checklist

Before each phase:

- [ ] All tests passing locally
- [ ] Feature flags work in dev environment
- [ ] Monitoring dashboard ready
- [ ] Rollback procedure tested
- [ ] Team notified of changes

## Common Issues and Solutions

### Issue: Commands not routing to DDD
- Check: Is `FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true`?
- Check: Is the specific category flag enabled?
- Check: Are there initialization errors in logs?

### Issue: DDD commands failing
- Check: Is fallback enabled?
- Check: Are all required services initialized?
- Check: Database/file permissions correct?

### Issue: Performance degradation
- Check: Event system causing delays?
- Check: Additional logging overhead?
- Check: Memory leaks in new system?

## Next Steps After Full Enablement

1. **Remove Legacy System** (Phase 4 completion)
2. **Optimize DDD Performance**
3. **Enable Advanced Features**:
   - Domain events for real-time updates
   - CQRS patterns for read optimization
   - Event sourcing for audit trails

## Remember

- **Start Small**: One category at a time
- **Monitor Closely**: Watch logs and metrics
- **Rollback Fast**: Don't hesitate if issues arise
- **Document Issues**: Help improve the system

The DDD system is ready - we just need to turn the key! 🔑