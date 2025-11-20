# Testing Technical Debt

## Overview

This document tracks testing-related technical debt discovered during development, particularly issues that cause tests to pass while actual code fails.

## Critical Issues

### 1. Mock Interface Mismatches (Priority: HIGH)

**Discovered**: June 2025 during DDD Phase 4  
**Impact**: Tests pass with 100% coverage but code fails in production

**Examples Found**:

- `CommandContext` methods mocked but not implemented: `canEmbed()`, `respondWithEmbed()`, `getAuthorDisplayName()`, `getAuthorAvatarUrl()`
- Repository method name mismatch: `findByOwnerId` (mock) vs `findByOwner` (actual)

**Root Cause**: Ad-hoc mock creation without interface verification

**Fix Required**:

- Complete mock consolidation (currently ~5% done)
- Add interface validation tests
- Use real classes with selective mocking

**Tracking**: See [Mock Interface Mismatch Prevention Guide](../testing/MOCK_INTERFACE_MISMATCH_PREVENTION.md)

### 2. Lack of Integration Tests (Priority: HIGH)

**Impact**: Interface mismatches between components not caught

**Current State**:

- Heavy reliance on unit tests with mocks
- No end-to-end command execution tests
- No tests that verify real components work together

**Fix Required**:

- Add integration test suite
- Test critical user paths with real implementations
- Mock only external services (API, database, Discord)

### 3. Mock Consolidation Incomplete (Priority: MEDIUM)

**Current Progress**: ~5% of tests use consolidated mocks

**Impact**:

- Inconsistent test patterns
- Duplicate mock code
- Higher chance of interface mismatches

**Fix Required**:

- Migrate remaining 95% of tests to consolidated mocks
- Create mock factories for all domain objects
- Enforce through pre-commit hooks

## Debt Items by Component

### Command System

- [ ] Add integration tests for all commands
- [ ] Verify CommandContext interface in tests
- [ ] Create CommandContext factory for tests
- [ ] Remove all ad-hoc command mocks

### Repository Layer

- [ ] Verify all repository method names in tests
- [ ] Create repository mock factories
- [ ] Add contract tests between services and repositories
- [ ] Test with in-memory implementations

### Application Services

- [ ] Integration tests for service layer
- [ ] Mock only repository and external services
- [ ] Verify service method signatures
- [ ] Test error handling paths

## Proposed Solutions

### Short-term (1-2 weeks)

1. Add interface validation tests for critical contracts
2. Create test factories for CommandContext and repositories
3. Fix existing mock mismatches

### Medium-term (1-2 months)

1. Complete mock consolidation to 100%
2. Add integration test suite
3. Implement mock verification utilities

### Long-term (3-6 months)

1. Consider TypeScript migration for compile-time checking
2. Implement contract testing framework
3. Add property-based testing for complex logic

## Metrics to Track

1. **Mock Consolidation Progress**: Currently 5%, target 100%
2. **Integration Test Coverage**: Currently ~0%, target 80% of user paths
3. **Mock Mismatch Incidents**: Track production failures due to test mocks
4. **Test Execution Time**: Ensure remains under 30 seconds

## Prevention Measures

1. **Code Review Checklist**:
   - No ad-hoc mocks
   - Integration test for new features
   - Mock methods verified against real class

2. **Automated Checks**:
   - Pre-commit hook for mock patterns
   - CI job for interface validation
   - Weekly mock consolidation report

3. **Developer Guidelines**:
   - Always use test factories
   - Prefer real classes over mocks
   - Write integration tests first

## Related Documents

- [Mock Interface Mismatch Prevention Guide](../testing/MOCK_INTERFACE_MISMATCH_PREVENTION.md)
- [Mock System Guide](../testing/MOCK_SYSTEM_GUIDE.md)
- [Test Philosophy and Patterns](../testing/TEST_PHILOSOPHY_AND_PATTERNS.md)

---

_Last Updated: June 2025_  
_Next Review: After DDD Phase 4 completion (Q3 2025)_
