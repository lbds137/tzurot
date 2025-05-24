# Testing Documentation

This directory contains comprehensive documentation for testing practices, procedures, and quality assurance.

## Quick Start

1. **Before Writing Tests**: Read [TEST_ANTIPATTERNS_GUIDE.md](TEST_ANTIPATTERNS_GUIDE.md)
2. **Set Up Pre-commit Hooks**: Run `./scripts/setup-pre-commit.sh`
3. **Use Test Helpers**: See [helpers/README.md](../../tests/helpers/README.md)

## Anti-Pattern Prevention 🛡️

We have automated checks to prevent common testing issues:

- **[ANTIPATTERN_PREVENTION_SUMMARY.md](ANTIPATTERN_PREVENTION_SUMMARY.md)** - Overview of our anti-pattern detection system
- **[TEST_ANTIPATTERNS_GUIDE.md](TEST_ANTIPATTERNS_GUIDE.md)** - Detailed guide with examples of bad/good patterns
- **[PREVENTING_LONG_RUNNING_TESTS.md](PREVENTING_LONG_RUNNING_TESTS.md)** - Specific guidance for timeout issues
- **[TIMEOUT_PREVENTION_SUMMARY.md](TIMEOUT_PREVENTION_SUMMARY.md)** - Summary of timeout prevention measures

## Test Documentation

### Coverage and Quality
- **[TEST_COVERAGE_SUMMARY.md](TEST_COVERAGE_SUMMARY.md)** - Current test coverage statistics
- **[CRITICAL_COVERAGE_GAPS.md](CRITICAL_COVERAGE_GAPS.md)** - Areas needing test coverage
- **[TEST_FIX_SUMMARY.md](TEST_FIX_SUMMARY.md)** - History of test fixes and improvements

### Testing Procedures
- **[MANUAL_TESTING_PROCEDURE.md](MANUAL_TESTING_PROCEDURE.md)** - Manual testing guidelines
- **[SIMULATED_TESTS_SUMMARY.md](SIMULATED_TESTS_SUMMARY.md)** - Simulated test scenarios
- **[TEST_STANDARDIZATION.md](TEST_STANDARDIZATION.md)** - Standards for writing tests

### Migration and Maintenance
- **[TEST_MIGRATION_PLAN.md](TEST_MIGRATION_PLAN.md)** - Plan for test migration
- **[TEST_MIGRATION_STATUS.md](TEST_MIGRATION_STATUS.md)** - Current migration status
- **[MOCK_MIGRATION_GUIDE.md](MOCK_MIGRATION_GUIDE.md)** - Guide for updating mocks
- **[TEST_PERSONALITIES_CLEANUP.md](TEST_PERSONALITIES_CLEANUP.md)** - Cleanup procedures

### Component-Specific
- **[COMMANDLOADER_TEST_APPROACH.md](COMMANDLOADER_TEST_APPROACH.md)** - Testing command loader

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
```

## Pre-commit Hooks

Install automated checks:
```bash
./scripts/setup-pre-commit.sh
```

This will check for:
1. Test anti-patterns
2. ESLint violations
3. Failing tests

## Best Practices

1. **Always use fake timers** for time-dependent tests
2. **Mock all external dependencies** (network, file system, console)
3. **Clean up in afterEach** (mocks, timers, listeners)
4. **Use generic test data** (no real emails/usernames)
5. **Keep tests isolated** (no shared state)
6. **Write concise test descriptions** (<80 characters)
7. **Await all async operations**
8. **Never commit .only() or .skip()**
