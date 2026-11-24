import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { TEST_TIMEOUTS } from './packages/common-types/src/constants/timing.js';
import { resolveLaneRedisUrl, resolveTestLane } from './packages/test-utils/src/testLane.js';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';
const testLane = resolveTestLane({ rootDir: __dirname, env: process.env });
process.env.TZUROT_TEST_LANE ||= testLane.lane;
// Real-Redis integration tests (vision fallback loop) import service modules whose
// module-level singletons connect at load time. resolveLaneRedisUrl defaults a
// blank/unset REDIS_URL to redis://127.0.0.1:6379/<redisDb>, rewrites a local URL
// whose path is empty, `/`, or `/0` to the checkout's per-lane logical DB (`/15`
// for lane a, `/14` for `tzurot-b`, etc.; see `packages/test-utils/src/testLane.ts`)
// instead of DB 0 (live dev data), keeps any other explicit `/<N>` DB path
// unchanged, and returns REDIS_URL unchanged when CI === 'true'.
process.env.REDIS_URL = resolveLaneRedisUrl({
  raw: process.env.REDIS_URL,
  redisDb: testLane.redisDb,
  env: process.env,
});
// DATABASE_URL is deliberately NOT defaulted here. Real-Postgres integration
// tests seed and mutate rows, so a default would have to carry credentials —
// which secretlint rejects in tracked source, and which would silently aim at
// whatever database the URL happened to name. The caller supplies it; tests
// that need it fail fast with the provisioning command in the message. CI sets
// it to the job's Postgres service. Locally, inspect and provision this
// checkout's lane integration database (`tzurot_integration_test` for lane a,
// `tzurot_integration_<lane>_test` for lanes b–e) once with:
//   pnpm ops test:lane --provision
// then build DATABASE_URL from the tzurot-postgres container in
// README.md § Local Development with that lane database name, apply migrations
// (`pnpm ops db:migrate` against that DATABASE_URL), and export the same value
// when running the tier.

/**
 * Vitest configuration for the real-dependency tiers run from tests/:
 * integration (*.integration.test.ts) and contract (*.contract.test.ts).
 *
 * Both share one runtime profile:
 * - Test cross-service flows / live external deps (real DB, BullMQ contracts)
 * - May be colocated with the code they lock (*.contract.test.ts anywhere) or
 *   live under tests/e2e/ (e.g. the BullMQ pair) — matched by suffix, repo-wide
 * - Use real timing (no fake timers)
 * - Coverage disabled — these tiers verify cross-service behavior / contracts,
 *   not in-service line coverage (the component + unit tiers carry coverage)
 *
 * CI note: the `component-integration-tests` job provisions BOTH Redis and a
 * pgvector Postgres service, and applies the real migrations to it before this
 * config runs — the trigger functions exist only in the migration files, so a
 * schema dump would not carry them. A real-Postgres `*.integration.test.ts`
 * therefore works in CI; locally it needs the containers up, the dedicated test
 * database provisioned, and DATABASE_URL exported (see the note above).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@tzurot/common-types': resolve(__dirname, './packages/common-types/src'),
      '@tzurot/api-clients': resolve(__dirname, './packages/api-clients/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',

    // Run the integration + contract tiers. Contract tests may be colocated with
    // the code they lock (e.g. the golden-fixture consumer test in ai-worker) or
    // live under tests/e2e/ (the BullMQ pair) — match both by suffix, repo-wide.
    include: ['**/*.integration.test.ts', '**/*.contract.test.ts'],
    // .claude/worktrees holds live agent checkouts of this same repo — exclude
    // them or the repo-wide glob sweeps their duplicate test files (see the
    // matching note in vitest.component.config.ts).
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/.claude/**'],

    // These tiers need longer timeouts
    testTimeout: TEST_TIMEOUTS.INTEGRATION_TEST,
    hookTimeout: TEST_TIMEOUTS.INTEGRATION_HOOK,

    // Use REAL timers (no fake timers)
    fakeTimers: {
      toFake: [],
    },

    // Run test files sequentially (no parallel forks). Real-dependency tiers must
    // not race each other on shared state. Replaces the Vitest-3
    // `poolOptions.forks.singleFork`, which Vitest 4 ignores.
    pool: 'forks',
    fileParallelism: false,

    // These tiers don't contribute coverage (test real external services)
    coverage: {
      enabled: false,
    },
  },
});
