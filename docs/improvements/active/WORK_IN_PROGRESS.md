# Work In Progress Tracker

## Overview
This document tracks all incomplete migrations, refactors, and half-finished work that must be addressed or abandoned during the DDD migration.

## Status as of June 18, 2025

### 1. Mock Migration
**Status**: 5% complete (6/133 test files migrated)
**Started**: ~Week 2
**Impact**: Inconsistent test patterns, complex setup, fragile tests
**Decision**: Complete during Phase 3 or abandon for fresh start with DDD

### 2. Module Refactoring  
**Status**: Partially complete
**Evidence**: 
- Some utilities extracted but core issues remain
- `utils/` directory has 28 files with mixed responsibilities
- Large modules still exist (webhookManager.js at 1768 lines)
**Decision**: Stop current approach, use DDD boundaries instead

### 3. Environment Variable Cleanup
**Status**: ✅ Completed in commit da8cbab
**Evidence**: Standardized naming convention applied (BOT_ prefix, no DEV variants)
**Decision**: Done - maintain standards going forward

### 4. Timer Injection
**Status**: ❌ Not complete (26 violations remain)
**Evidence**: Running `npm run lint:timers` shows 11 errors, 15 warnings
**Blocking**: Test performance, fake timer usage
**Critical Files**:
- `utils.js` - Direct setTimeout
- `threadHandler.js` - Global timer in module  
- `messageThrottler.js` - Direct setTimeout
- `dmHandler.js` - Timer issues
**Decision**: Address remaining violations

### 5. Singleton Removal
**Status**: ❌ Not complete (14 files with singleton patterns)
**Evidence**: Still using `module.exports = new` and `getInstance` patterns
**Blocking**: Testability, modularity
**Remaining Singletons**:
- `logger.js`
- `PersonalityManager.js` (has getInstance)
- `ConversationManager.js` (has getInstance)
- `pluralkitMessageStore.js` (exports instance)
- Various DDD services using singleton pattern
**Decision**: Legacy singletons remain, DDD using different pattern

### 6. Express Migration
**Status**: Planned but not started
**Documentation**: `EXPRESS_MIGRATION.md`
**Decision**: FROZEN - Do not start until after DDD

### 7. Database Implementation
**Status**: Planned but not started
**Documentation**: `DATABASE_MIGRATION_PLAN.md`
**Decision**: FROZEN - Do not start until after DDD

### 8. Multi-User Scalability
**Status**: Analysis complete, implementation not started
**Documentation**: `MULTI_USER_SCALABILITY.md`
**Decision**: FROZEN - Architecture must be fixed first

### 9. Documentation Consolidation
**Status**: Partially complete
**Evidence**: Recent consolidation efforts in commits
**Decision**: Continue only if it helps DDD migration

### 10. Testing Anti-patterns
**Status**: Identified, enforcement scripts created
**Evidence**: 
- Scripts exist to check patterns
- Many tests still violate guidelines
**Decision**: Fix as part of DDD migration, not separately

## Action Items

### Must Complete (Phase 0)
- [ ] Timer injection in 4 critical files
- [ ] Singleton removal in 4 critical files
- [ ] Document any other WIP discovered

### Must Stop
- [ ] No new utility functions in `/utils`
- [ ] No new facades or compatibility layers
- [ ] No partial refactors
- [ ] No new features

### Must Communicate
- [ ] Team alignment on freeze
- [ ] Stakeholder notification
- [ ] Update PR templates

## Lessons Learned

1. **Partial migrations create more debt than they solve**
   - Mock migration at 5% made testing harder, not easier
   
2. **Band-aid solutions cascade**
   - Each quick fix requires more fixes
   - Simple changes now touch 50+ files

3. **Architecture must come first**
   - Features built on bad architecture multiply problems
   - Better to freeze and fix than continue accumulating debt

## Remember

> "Every incomplete migration is a weight dragging down the project. Either finish it or abandon it - there is no middle ground."