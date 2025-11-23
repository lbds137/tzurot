# Testing Utilities

Scripts for analyzing test suite quality, performance, and patterns.

## Scripts

- **check-test-antipatterns.js** - Detect common testing anti-patterns
- **check-test-mocking-patterns.js** - Verify mock consistency across tests
- **check-timer-patterns.js** - Find timer-related test issues
- **comprehensive-test-timing-analysis.js** - Analyze test execution times
- **identify-slow-tests.js** - Find slow tests that need optimization
- **analyze-test-structure.js** - Check test file organization
- **validate-test-syntax.js** - Validate test syntax and structure
- **verify-mock-methods.js** - Verify mocked methods exist in source
- **update-coverage-summary.js** - Update test coverage summary

## Usage

```bash
# Check for anti-patterns
node scripts/testing/check-test-antipatterns.js

# Find slow tests
node scripts/testing/identify-slow-tests.js

# Analyze test timing
node scripts/testing/comprehensive-test-timing-analysis.js
```

**⚠️ See:** `tzurot-testing` skill for comprehensive testing patterns and best practices
