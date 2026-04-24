# PGLite Integration Test Setup

Integration tests in Tzurot v3 use PGLite (in-memory PostgreSQL with pgvector) for zero-setup database testing.

## Quick Start

```bash
# Run integration tests (no DATABASE_URL needed)
pnpm test:int

# Schema is auto-generated from Prisma
pnpm ops test:generate-schema
```

## Schema Management (CRITICAL)

- Schema SQL is auto-generated from `prisma/schema.prisma`
- Stored in `packages/test-utils/schema/pglite-schema.sql`
- **Regenerate after Prisma migrations**: `pnpm ops test:generate-schema`
- Uses `prisma migrate diff --from-empty --to-schema` plus a sweep of migration SQL for CHECK constraints (Prisma's schema-diff can't represent CHECKs) — never write SQL manually

## Environment Detection

| Environment               | Database         | Redis |
| ------------------------- | ---------------- | ----- |
| Local (no DATABASE_URL)   | PGLite           | Mock  |
| Local (with DATABASE_URL) | Real Postgres    | Mock  |
| CI (GITHUB_ACTIONS=true)  | Service Postgres | Real  |

## Test Setup Pattern

```typescript
import {
  setupTestEnvironment,
  type TestEnvironment,
} from '../../../../../tests/helpers/setup-pglite.js';

let testEnv: TestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnvironment();
  // testEnv.prisma, testEnv.redis available
});

afterAll(async () => {
  await testEnv.cleanup();
});
```

## Test File Naming

| Type        | Pattern            | Location        | Infrastructure |
| ----------- | ------------------ | --------------- | -------------- |
| Unit        | `*.test.ts`        | Next to source  | Fully mocked   |
| Integration | `*.int.test.ts`    | Next to source  | PGLite         |
| Schema      | `*.schema.test.ts` | `common-types/` | Zod only       |
| E2E         | `*.e2e.test.ts`    | `tests/e2e/`    | Real services  |

## When to Use Integration vs Unit Tests

### Use Integration Tests (\*.int.test.ts) For

- Database operations with complex queries (joins, transactions)
- Services that depend on Prisma
- Business logic that needs real database behavior

### Use Unit Tests (\*.test.ts) For

- Pure utility functions
- Discord interaction handlers (mock the session/API)
- Logic that doesn't depend on database

### Use E2E Tests (\*.e2e.test.ts) For

- Cross-service flows (BullMQ contracts)
- Database connectivity smoke tests
- External service integration verification

## Key Differences

- **Unit tests**: Mock all dependencies, test one function
- **Integration tests**: Use PGLite database, co-located next to source
- **E2E tests**: Test cross-service flows, centralized in tests/e2e/

## Files

- Setup: `packages/test-utils/src/setup-pglite.ts`
- Schema: `packages/test-utils/schema/pglite-schema.sql`
- Generator: `packages/tooling/src/test/generate-schema.ts` (invoked via `pnpm ops test:generate-schema`)
