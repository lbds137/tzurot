# PGLite Integration Test Setup

Integration tests in Tzurot v3 use PGLite (in-memory PostgreSQL with pgvector) for zero-setup database testing.

## Quick Start

```bash
# Run integration tests (no DATABASE_URL needed)
pnpm test:integration

# Schema is auto-generated from Prisma
./scripts/testing/regenerate-pglite-schema.sh
```

## Schema Management (CRITICAL)

- Schema SQL is auto-generated from `prisma/schema.prisma`
- Stored in `tests/integration/schema/pglite-schema.sql`
- **Regenerate after Prisma migrations**: `./scripts/testing/regenerate-pglite-schema.sh`
- Uses `prisma migrate diff --from-empty --to-schema` - never write SQL manually

## Environment Detection

| Environment               | Database         | Redis |
| ------------------------- | ---------------- | ----- |
| Local (no DATABASE_URL)   | PGLite           | Mock  |
| Local (with DATABASE_URL) | Real Postgres    | Mock  |
| CI (GITHUB_ACTIONS=true)  | Service Postgres | Real  |

## Test Setup Pattern

```typescript
import { setupTestEnvironment, type TestEnvironment } from './setup';

let testEnv: TestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnvironment();
  // testEnv.prisma, testEnv.redis available
});

afterAll(async () => {
  await testEnv.cleanup();
});
```

## When to Use Integration vs Unit Tests

### Use Integration Tests For

- Database operations with complex queries (joins, transactions)
- Cross-service communication (bot-client → api-gateway → ai-worker)
- Business logic spanning multiple services

### Use Unit Tests For

- Pure utility functions
- UI/Discord interaction handlers (mock the session/API instead)
- Simple CRUD operations

## Key Differences

- **Unit tests**: Mock all dependencies, test one function
- **Integration tests**: Use real components (except external APIs like Discord, OpenRouter)

## Files

- Setup: `tests/integration/setup.ts`
- Schema: `tests/integration/schema/pglite-schema.sql`
- Regeneration script: `scripts/testing/regenerate-pglite-schema.sh`
