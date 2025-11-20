# Production Deployment Runbook - DDD Command System

## Overview

This runbook provides step-by-step procedures for deploying the DDD command system to production with feature flags, monitoring, and rollback capabilities.

## Pre-Deployment Checklist

### Code Readiness
- [ ] All Phase 3 commands migrated and tested (18/18 ✅)
- [ ] 95%+ test coverage achieved across all DDD commands
- [ ] CommandIntegrationAdapter includes all command mappings
- [ ] Feature flags configured for gradual rollout
- [ ] Emergency rollback procedures documented

### Infrastructure Readiness
- [ ] Monitoring infrastructure deployed
- [ ] Health check endpoints available
- [ ] Database backups scheduled (for personality data)
- [ ] Log aggregation configured
- [ ] Alert thresholds set

### Team Readiness
- [ ] Operations team briefed on rollback procedures
- [ ] Support team aware of feature flag controls
- [ ] Emergency contact list updated
- [ ] Rollback decision tree documented

## Deployment Procedure

### Step 1: Deploy with DDD System Disabled

```bash
# 1. Merge feat/ddd-migration to develop
git checkout develop
git pull origin develop
git merge feat/ddd-migration
git push origin develop

# 2. Create release branch
git checkout -b release/v2.1.0
git push -u origin release/v2.1.0

# 3. Update version and changelog
# Edit package.json version
# Update CHANGELOG.md with DDD system addition

# 4. Create PR to main
gh pr create --base main --title "release: v2.1.0 - DDD command system (disabled)"
```

### Step 2: Production Deployment

```bash
# After PR approval and merge to main
git checkout main
git pull origin main

# Deploy to production with DDD flags disabled
export FEATURE_FLAG_DDD_COMMANDS_ENABLED=false
export FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=false

# Deploy using your deployment method
# Example: Railway deployment
railway up

# Verify deployment
curl https://your-bot-domain/health
```

### Step 3: Verify Baseline Operation

```bash
# Test basic bot functionality
# 1. Verify bot is online in Discord
# 2. Test a few legacy commands
# 3. Check memory usage and performance

# Monitor for 30 minutes minimum
# - No increase in error rates
# - Memory usage stable
# - Response times unchanged
```

## Feature Flag Rollout Procedures

### Stage 1: Enable Utility Commands (Week 1)

```bash
# Enable core DDD infrastructure
export FEATURE_FLAG_DDD_COMMANDS_ENABLED=true
export FEATURE_FLAG_DDD_COMMANDS_INTEGRATION=true

# Enable utility commands only
export FEATURE_FLAG_DDD_COMMANDS_UTILITY=true

# Restart bot processes
railway restart
```

**Commands Affected:** ping, status, help, notifications, debug, purgbot, volumetest

**Monitoring:**
- Watch error rates for 2 hours
- Compare response times to baseline
- Verify feature parity

**Success Criteria:**
- Zero errors in DDD utility commands
- Response times within 10% of legacy
- All functionality working correctly

**Rollback if needed:**
```bash
export FEATURE_FLAG_DDD_COMMANDS_UTILITY=false
railway restart
```

### Stage 2: Enable Authentication Commands (Week 2)

```bash
# Prerequisites: Stage 1 successful for 1 week

# Enable authentication commands
export FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=true
railway restart
```

**Commands Affected:** auth, verify

**Critical Monitoring:**
- Authentication flow integrity
- Token generation and validation
- NSFW verification process

**Success Criteria:**
- No authentication failures
- Token security maintained
- All auth workflows functional

### Stage 3: Enable Conversation Commands (Week 3)

```bash
# Prerequisites: Stages 1-2 successful

# Enable conversation commands  
export FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=true
railway restart
```

**Commands Affected:** activate, deactivate, reset, autorespond

**Critical Monitoring:**
- Channel activation state
- Conversation tracking accuracy
- Auto-response behavior

### Stage 4: Enable Personality Commands (Weeks 4-5)

```bash
# Prerequisites: All previous stages successful
# Additional safeguard: Daily data backups

# Enable personality commands (HIGH RISK)
export FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=true
railway restart
```

**Commands Affected:** add, remove, info, alias, list

**Critical Monitoring:**
- Data integrity checks
- Personality creation/deletion
- Alias management
- Performance under load

**Enhanced Safeguards:**
- Hourly data backups during first 24 hours
- Side-by-side comparison testing
- Ready rollback at first sign of issues

## Monitoring and Health Checks

### Key Metrics to Track

```javascript
// Command execution metrics
{
  "metric": "command_execution_time",
  "command": "add",
  "system": "ddd",
  "duration_ms": 150,
  "timestamp": "2025-06-14T10:30:00Z"
}

// Error rate tracking
{
  "metric": "command_error_rate", 
  "system": "ddd",
  "errors_per_hour": 0,
  "total_executions": 1547
}

// System resource usage
{
  "metric": "memory_usage",
  "current_mb": 512,
  "baseline_mb": 480,
  "increase_percent": 6.7
}
```

### Health Check Endpoints

```bash
# Overall system health
curl https://your-bot-domain/health
# Expected: {"status": "healthy", "uptime": "72h"}

# Feature flag status
curl https://your-bot-domain/health/features
# Expected: {"ddd.commands.enabled": true, ...}

# Command system status
curl https://your-bot-domain/health/commands
# Expected: {"legacy_active": true, "ddd_active": true, "commands_migrated": 18}
```

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Error Rate | > 0.1% | > 1% |
| Response Time | +20% | +50% |
| Memory Usage | +25% | +50% |
| Failed Commands | > 5/hour | > 20/hour |

## Emergency Rollback Procedures

### Immediate Rollback (< 2 minutes)

```bash
# EMERGENCY: Disable all DDD commands instantly
export FEATURE_FLAG_DDD_COMMANDS_ENABLED=false
railway restart

# Verify rollback successful
curl https://your-bot-domain/health/features
# Should show all DDD flags as false
```

### Selective Rollback

```bash
# Rollback specific command category
export FEATURE_FLAG_DDD_COMMANDS_PERSONALITY=false  # High-risk category
export FEATURE_FLAG_DDD_COMMANDS_CONVERSATION=false # If state issues
export FEATURE_FLAG_DDD_COMMANDS_AUTHENTICATION=false # If auth problems
export FEATURE_FLAG_DDD_COMMANDS_UTILITY=false     # If basic issues

railway restart
```

### Full System Rollback

If feature flag rollback is insufficient:

```bash
# 1. Revert to previous release
git checkout main
git revert HEAD  # Revert the DDD system deployment
git push origin main

# 2. Deploy previous version
railway deploy

# 3. Verify system restored
# Test all critical functionality
```

## Post-Deployment Verification

### Automated Tests

```bash
# Run production smoke tests
npm run test:production

# Test all command categories
npm run test:commands:smoke

# Verify data integrity
npm run test:data:integrity
```

### Manual Verification Checklist

- [ ] Bot responds to basic commands
- [ ] Help system shows all commands correctly  
- [ ] Personality operations work correctly
- [ ] Authentication flow intact
- [ ] Error handling working properly
- [ ] Performance within acceptable ranges

## Communication Plan

### Deployment Announcement

**Internal Team:**
```
🚀 DDD Command System Deployment - Phase 4 Stage X

Status: In Progress
Commands Affected: [list]
Monitoring: Active
Expected Duration: [time]
Rollback Ready: Yes

Next Update: [time]
```

**User-Facing (if needed):**
```
🔧 Brief maintenance in progress
Some commands may have slightly different response times
All functionality remains available
Expected completion: [time]
```

### Incident Communication

```
🚨 Issue Detected - DDD Command System

Impact: [description]
Commands Affected: [list]
Status: Investigating / Rolling Back / Resolved
ETA: [time]

Actions Taken:
- [action 1]
- [action 2]

Next Update: [time]
```

## Success Criteria

### Performance Targets
- **Response Time**: ±10% of legacy baseline
- **Memory Usage**: <20% increase
- **Error Rate**: <0.1%
- **Availability**: >99.9%

### Functional Targets  
- **Feature Parity**: 100% - all legacy functionality preserved
- **Data Integrity**: 100% - no data loss or corruption
- **User Experience**: No breaking changes visible to users

### Quality Targets
- **Monitoring Coverage**: 100% of critical paths
- **Rollback Time**: <2 minutes for emergency
- **Recovery Time**: <5 minutes for any stage

## Troubleshooting Guide

### Common Issues

**Issue: Commands not routing to DDD system**
```bash
# Check feature flags
curl https://your-bot-domain/health/features

# Verify CommandIntegrationAdapter loaded
grep "CommandIntegrationAdapter" /var/log/bot.log

# Check command mapping
node -e "console.log(require('./src/adapters/CommandIntegrationAdapter').shouldUseNewSystem('ping', true))"
```

**Issue: Higher memory usage than expected**
```bash
# Profile memory usage
node --inspect bot.js
# Connect to Chrome DevTools for memory profiling

# Check for memory leaks
npm run test:memory-leak
```

**Issue: Data inconsistency**
```bash
# Run data integrity check
npm run check:data-integrity

# Compare legacy vs DDD results
npm run test:comparison-test

# Restore from backup if needed
./scripts/restore-backup.sh [timestamp]
```

---

*Production Deployment Runbook v1.0*
*Created: June 14, 2025*
*Next Review: After Stage 1 completion*