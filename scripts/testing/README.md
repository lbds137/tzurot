# Testing Utilities

Scripts for analyzing test suite quality, performance, and patterns.

## Test Coverage Audits

The test coverage audit scripts have been migrated to the ops CLI:

```bash
# Contract coverage audit (schemas with contract tests)
pnpm ops test:audit-contracts
pnpm ops test:audit-contracts --update   # Update baseline
pnpm ops test:audit-contracts --strict   # Zero tolerance mode

# Service integration audit (services with component tests)
pnpm ops test:audit-services
pnpm ops test:audit-services --update    # Update baseline
pnpm ops test:audit-services --strict    # Zero tolerance mode

# Run both audits
pnpm ops test:audit
```

## Analysis Scripts

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

# Regenerate PGLite schema for tests
./scripts/testing/regenerate-pglite-schema.sh
```

**See:** `tzurot-testing` skill for comprehensive testing patterns and best practices
