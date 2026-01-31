# Testing Utilities

Scripts for testing infrastructure and coverage audits.

## Test Coverage Audits

The test coverage audit scripts are in the ops CLI:

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

## Scripts

- **check-untested-files.js** - Find source files without corresponding tests
- **regenerate-pglite-schema.sh** - Regenerate PGLite schema for tests

## Usage

```bash
# Regenerate PGLite schema for tests
./scripts/testing/regenerate-pglite-schema.sh
```

**See:** `tzurot-testing` skill for comprehensive testing patterns and best practices
