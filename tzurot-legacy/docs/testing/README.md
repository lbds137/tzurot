# Testing Documentation

This directory contains comprehensive documentation for testing practices, procedures, and quality assurance.

## 📚 Core Documentation (Start Here)

### 1. [TEST_PHILOSOPHY_AND_PATTERNS.md](TEST_PHILOSOPHY_AND_PATTERNS.md)
- **Testing philosophy**: Behavior-based testing principles
- **Best practices**: How to write effective tests
- **Anti-pattern reference**: Common mistakes and how to avoid them

### 2. [MOCK_SYSTEM_GUIDE.md](MOCK_SYSTEM_GUIDE.md)
- **Mock patterns**: Required vs deprecated patterns
- **Migration guide**: How to update existing tests
- **Verification**: Preventing non-existent method mocks

### 3. [TESTING_CASE_STUDIES.md](TESTING_CASE_STUDIES.md)
- **Real bugs**: getAllReleases, getPersonalityByAlias, timer issues
- **Root causes**: Why tests missed these bugs
- **Lessons learned**: How to prevent similar issues

### 4. [TIMER_PATTERNS_COMPLETE.md](TIMER_PATTERNS_COMPLETE.md)
- **Timer patterns**: Injectable timers for testability
- **Testing with timers**: Fake timers vs real timers
- **Migration guide**: Converting legacy timer code

## 🚨 Critical Updates

### Mock Verification Now Enforced
Following the `getAllReleases` bug, we now enforce:
- **Pre-commit verification** of all mocked methods
- **Boy Scout Rule**: Migrate tests when touching files
- **Current status**: Only ~5% of tests use safe mocks

### Timer Patterns Consolidated
All timer documentation merged into [TIMER_PATTERNS_COMPLETE.md](TIMER_PATTERNS_COMPLETE.md)

## Quick Start

1. **Read Philosophy First**: [TEST_PHILOSOPHY_AND_PATTERNS.md](TEST_PHILOSOPHY_AND_PATTERNS.md)
2. **Set Up Pre-commit Hooks**: `./scripts/setup-pre-commit.sh`
3. **Use Consolidated Mocks**: [MOCK_SYSTEM_GUIDE.md](MOCK_SYSTEM_GUIDE.md)
4. **Check Timer Patterns**: [TIMER_PATTERNS_COMPLETE.md](TIMER_PATTERNS_COMPLETE.md)

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx jest tests/unit/path/to/test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm run test:watch

# Check for anti-patterns
node scripts/check-test-antipatterns.js

# Verify mock methods exist
node scripts/verify-mock-methods.js

# Check timer patterns
node scripts/check-timer-patterns.js
```

## Pre-commit Hooks

Install automated checks:
```bash
./scripts/setup-pre-commit.sh
```

This will check for:
1. Test anti-patterns
2. Mock method verification
3. Timer pattern violations
4. ESLint violations
5. Failing tests

## Additional Documentation

### Coverage and Quality
- [TEST_COVERAGE_SUMMARY.md](TEST_COVERAGE_SUMMARY.md) - Current test coverage statistics
- [CRITICAL_COVERAGE_GAPS.md](CRITICAL_COVERAGE_GAPS.md) - Areas needing test coverage
- [MOCK_MIGRATION_STATUS.json](MOCK_MIGRATION_STATUS.json) - Mock migration progress

### Testing Procedures
- [MANUAL_TESTING_PROCEDURE.md](MANUAL_TESTING_PROCEDURE.md) - Manual testing guidelines
- [COMMANDLOADER_TEST_APPROACH.md](COMMANDLOADER_TEST_APPROACH.md) - Testing command loader

### Historical References
- [getAllReleases_BUG_POSTMORTEM.md](getAllReleases_BUG_POSTMORTEM.md) - Detailed bug analysis

## Best Practices Summary

### Do's ✅
- Test behavior, not implementation
- Use fake timers for all delays
- Mock all external dependencies
- Clean up in afterEach
- Use generic test data
- Keep tests isolated
- Await all async operations
- Use consolidated mock system

### Don'ts ❌
- Test private methods
- Use real timeouts
- Create ad-hoc mocks
- Share state between tests
- Use real user data
- Commit .only() or .skip()
- Mock non-existent methods
- Execute code during import

## The Boy Scout Rule

**"Always leave the test file a little better than you found it"**

When working on ANY test file:
1. **Fix your immediate task** (required)
2. **Migrate at least ONE other test** to consolidated mocks (encouraged)
3. **Update mock migration progress** in commit message

Example: "Mock migration progress: 7/133 files (5.3%)"