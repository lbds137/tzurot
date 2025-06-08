# Technical Debt Inventory

## Critical Debt (Blocks DDD Migration)

### 1. Timer Injection Issues
**Impact**: Tests take 10x longer than necessary, flaky tests  
**Files Affected**: ~15 files with hardcoded setTimeout  
**Solution**: Inject delay functions
**Effort**: 2 days
**Priority**: IMMEDIATE (Phase 0)

### 2. Singleton Exports  
**Impact**: Untestable code, circular dependencies
**Files Affected**: 8+ major modules
**Solution**: Export classes, not instances
**Effort**: 3 days  
**Priority**: IMMEDIATE (Phase 0)

### 3. God Objects
**Impact**: 52 files depend on PersonalityManager
**Worst Offenders**:
- `PersonalityManager` - 380 references
- `WebhookManager` - 1768 lines
- `AIService` - Complex dependencies
**Solution**: DDD bounded contexts
**Effort**: Full DDD migration
**Priority**: Core problem DDD solves

## Architectural Debt

### 4. No Clear Boundaries
**Symptoms**:
- Utils folder with 28 unrelated files
- Mixed responsibilities everywhere
- Business logic in handlers
**Solution**: Domain-driven design with clear contexts
**Effort**: 11 weeks (full DDD)

### 5. Cascading Dependencies
**Example**: Making getPersonality async touched 52 files
**Root Cause**: No abstraction layers
**Solution**: Repository pattern, dependency injection
**Effort**: Part of DDD migration

### 6. Mixed Sync/Async Patterns
**Problem**: Synchronous assumptions with async realities
**Symptoms**: 
- Lazy loading added as afterthought
- Hidden API calls in getters
**Solution**: Clear async boundaries in domain layer

## Testing Debt

### 7. Incomplete Mock Migration
**Status**: 5% complete (6/133 files migrated)
**Problems**:
- Inconsistent mock patterns
- Complex test setup
- Fragile tests
**Solution**: Complete migration or abandon for fresh start
**Effort**: 2 weeks (or ignore if DDD provides clean break)

### 8. Test Anti-patterns
**Issues Found**:
- Tests checking implementation not behavior
- Real timers in tests
- Excessive mocking of internals
- jest.resetModules() breaking imports
**Solution**: Behavior-driven tests with DDD

### 9. Slow Test Suite
**Current**: Approaching 1 minute
**Target**: < 30 seconds
**Blockers**: Real timers, excessive I/O, poor mocking

## Code Quality Debt

### 10. Large Files
**Violations**:
- `webhookManager.js` - 1768 lines
- `personalityHandler.js` - 748 lines  
- Multiple files > 500 lines
**Solution**: Extract to domain services

### 11. Configuration Chaos
**Problems**:
- Environment variables scattered
- No validation
- Defaults in multiple places
**Solution**: Centralized configuration module
**Effort**: 2 days

### 12. Error Handling Inconsistency
**Issues**:
- Some functions throw, others return null
- Inconsistent error messages
- Lost stack traces
**Solution**: Domain-level error handling

## Performance Debt

### 13. Memory Leaks Potential
**Risk Areas**:
- Unbounded caches
- Event listener accumulation
- Conversation history growth
**Solution**: Proper lifecycle management in domain

### 14. Inefficient Data Access
**Problems**:
- Full personality loaded for single field
- No pagination for history
- Repeated API calls
**Solution**: Repository pattern with projections

## Operational Debt

### 15. No Monitoring
**Missing**:
- Performance metrics
- Error rates by component
- Domain event tracking
**Solution**: Built into DDD from start

### 16. Poor Deployment Story
**Issues**:
- No rollback strategy
- No feature flags
- No canary deployments
**Solution**: Address after DDD migration

## Documentation Debt

### 17. Scattered Documentation
**Current State**:
- 24 improvement documents
- Outdated architecture docs
- Missing onboarding guide
**Solution**: Consolidate during Phase 4

### 18. No Domain Model Documentation
**Missing**:
- Bounded context maps
- Aggregate boundaries  
- Event flow diagrams
**Solution**: Create during DDD Phase 1

## Quantified Impact

### Current Pain Level (1-10 scale)
- Developer Productivity: 3/10
- Code Maintainability: 2/10
- System Reliability: 6/10
- Test Confidence: 4/10
- Deployment Confidence: 3/10

### Cost of Inaction
- Week 4: Productivity → 1/10
- Week 6: Maintainability → 0/10
- Week 8: Project abandoned

### Expected Post-DDD Scores
- Developer Productivity: 8/10
- Code Maintainability: 9/10
- System Reliability: 8/10
- Test Confidence: 9/10
- Deployment Confidence: 7/10

## Debt Payment Schedule

### Phase 0 (Week 1) - Critical
1. Timer injection
2. Singleton removal
3. Basic monitoring

### Phase 1-2 (Weeks 2-4) - Enablers  
1. Clean domain implementation
2. Proper testing patterns
3. Clear boundaries

### Phase 3 (Weeks 5-8) - Migration
1. God object elimination
2. Cascading dependency fix
3. Performance optimization

### Phase 4 (Weeks 9-11) - Cleanup
1. Documentation consolidation
2. Final debt elimination
3. Monitoring implementation

## Debt Metrics to Track

Daily:
- File size violations
- New singletons created
- Circular dependencies
- Test execution time

Weekly:
- Files per PR average
- Test coverage change
- Performance benchmarks
- Error rates

## Remember

> "Technical debt is not just about code quality. It's about the team's ability to deliver value. When debt prevents delivery, it must be paid."

This inventory represents ~3 years of typical technical debt accumulated in 3 weeks. The DDD migration is not optional - it's survival.