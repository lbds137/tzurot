# Branch Strategy for DDD Migration

## Current Situation
- On `develop` branch with uncommitted changes
- Mix of bugfix (async personality loading) and linting changes
- New DDD documentation created
- Fear of deployment due to lack of integration tests

## Proposed Branch Structure

```
main
  │
  └── develop
        │
        ├── fix/personality-error-message (immediate)
        │     ├── Commit 1: Core bugfix only
        │     └── Commit 2: Linting/formatting
        │
        └── feat/ddd-migration (long-term)
              ├── Phase 0: Stop bleeding
              ├── Phase 1: Domain core
              ├── Phase 2: Adapters
              ├── Phase 3: Migration
              └── Phase 4: Cleanup
```

## Immediate Steps

### 1. Create bugfix branch
```bash
# Stash all changes first
git stash

# Create and switch to bugfix branch
git checkout -b fix/personality-error-message

# Apply stashed changes
git stash pop
```

### 2. Separate commits

#### Commit 1: Core async personality bugfix
Files with functional changes:
- `src/core/personality/PersonalityManager.js` (async getPersonality)
- `src/utils/aiErrorHandler.js` (await getPersonality)
- `src/aiService.js` (await analyzeErrorAndGenerateMessage)
- Test files that needed async updates

#### Commit 2: Linting and formatting
Files with only formatting changes:
- `src/routes/avatars.js`
- `src/routes/health.js`
- `src/utils/avatarStorage.js`
- `src/httpServer.js`

### 3. Create DDD migration branch
```bash
# After bugfix is merged to develop
git checkout develop
git pull origin develop
git checkout -b feat/ddd-migration

# Commit documentation
git add docs/improvements/DDD*.md
git add docs/improvements/FEATURE_FREEZE_NOTICE.md
git add docs/improvements/TECHNICAL_DEBT_INVENTORY.md
git add docs/improvements/IMPROVEMENT_CONSOLIDATION_STATUS.md
git add docs/improvements/PERSONALITY_GETTER_ANALYSIS.md
git commit -m "docs: comprehensive DDD migration plan and freeze notice"
```

## Deployment Strategy

### For bugfix branch:
1. **Staged rollout**:
   - Deploy to dev environment first
   - Monitor for 24 hours
   - Deploy to small % of production
   - Full rollout if stable

2. **Rollback plan**:
   - Tag current develop: `git tag pre-async-personality`
   - Document exact revert commands
   - Have hotfix branch ready

3. **Monitoring**:
   - Watch for increased error rates
   - Monitor async timeout errors
   - Check personality loading performance

### For DDD branch:
1. **No deployment until Phase 1 complete**
2. **Parallel system testing in dev**
3. **Feature flags for gradual rollout**
4. **Each phase gets own PR to develop**

## Risk Mitigation

### Integration Test Gap
Since we lack integration tests:
1. **Manual test checklist** for bugfix
2. **Canary deployment** (1-5% of traffic)
3. **Active monitoring** during rollout
4. **Quick rollback** capability

### DDD Migration Risks
1. **Parallel development** = no production risk
2. **Feature freeze** = no moving targets
3. **Phase gates** = stop if issues arise
4. **Event sourcing** = audit trail for debugging

## Branch Lifecycle

### Bugfix branch:
- Lives 1-2 days max
- Merge to develop ASAP
- Delete after merge
- Tag the merge commit

### DDD migration branch:
- Lives 11 weeks
- Regular rebasing from develop (weekly)
- Sub-branches for each phase
- Squash merge at end

## Commands Summary

```bash
# For bugfix
git checkout -b fix/personality-error-message
# ... make commits ...
gh pr create --base develop --title "fix: async personality error message loading"

# For DDD
git checkout -b feat/ddd-migration
# ... add documentation ...
git commit -m "docs: comprehensive DDD migration plan"
gh pr create --base develop --title "docs: DDD migration plan and feature freeze"

# For each DDD phase
git checkout -b feat/ddd-phase-0
# ... implement phase ...
gh pr create --base feat/ddd-migration --title "feat: DDD Phase 0 - Stop the bleeding"
```

## Remember

> "The bugfix is ground zero. Deploy it carefully. The DDD migration is the cure. Build it carefully."

Small, careful steps for the bugfix. Bold, systematic steps for the migration.