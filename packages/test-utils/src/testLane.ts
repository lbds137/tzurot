/**
 * Per-checkout test lane resolution.
 *
 * Isolates Redis logical DB indexes and real-Postgres integration database
 * names across parallel repo checkouts (`tzurot`, `tzurot-b`..`tzurot-e`) so
 * component and integration suites can run concurrently without cross-talk.
 * Pinned by unit tests in `packages/test-utils/src/testLane.test.ts`.
 */

import { existsSync } from 'node:fs';
import { basename, dirname, join, normalize, sep } from 'node:path';

export type TestLane = 'a' | 'b' | 'c' | 'd' | 'e';

/**
 * Redis logical DB index per test lane.
 * Explicit mapping (`packages/test-utils/src/testLane.test.ts`); DB 0 holds
 * live local dev data and is excluded from the test lane table.
 */
export const TEST_LANE_REDIS_DB = {
  /** Primary checkout (`tzurot`), CI, and fallback lane (Redis DB 15) */
  a: 15,
  /** Parallel checkout `tzurot-b` (Redis DB 14) */
  b: 14,
  /** Parallel checkout `tzurot-c` (Redis DB 13) */
  c: 13,
  /** Parallel checkout `tzurot-d` (Redis DB 12) */
  d: 12,
  /** Parallel checkout `tzurot-e` (Redis DB 11) */
  e: 11,
} as const satisfies Record<TestLane, number>;

const ALLOWED_TEST_LANES: readonly TestLane[] = ['a', 'b', 'c', 'd', 'e'];

function isTestLane(value: string): value is TestLane {
  return (ALLOWED_TEST_LANES as readonly string[]).includes(value);
}

/**
 * Return the dedicated real-Postgres integration database name for `lane`.
 * Every lane database name ends in `_test` to satisfy the safety guard in
 * `tests/e2e/cacheInvalidationTriggers.integration.test.ts`.
 */
export function integrationDbNameForLane(lane: TestLane): string {
  return lane === 'a' ? 'tzurot_integration_test' : `tzurot_integration_${lane}_test`;
}

/**
 * Strip a linked `/.claude/worktrees/<name>` suffix from `dir` so agent
 * worktrees resolve to their parent checkout's lane (`packages/test-utils/src/testLane.test.ts`).
 */
export function checkoutRootOf(dir: string): string {
  const normalized = normalize(dir);
  const worktreeMarker = `${sep}.claude${sep}worktrees${sep}`;
  const markerIndex = normalized.indexOf(worktreeMarker);
  if (markerIndex > 0) {
    return normalized.slice(0, markerIndex);
  }
  return normalized;
}

/**
 * Resolve the active test lane from `env.TZUROT_TEST_LANE` (when non-empty) or
 * from the checkout directory basename (`tzurot-b`..`tzurot-e` → `b`..`e`,
 * everything else → `a`).
 */
export function resolveTestLane(opts: {
  rootDir: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): {
  lane: TestLane;
  redisDb: number;
  integrationDbName: string;
  source: 'env' | 'path';
} {
  const rawEnvLane = opts.env.TZUROT_TEST_LANE;
  if (rawEnvLane !== undefined && rawEnvLane.length > 0) {
    if (!isTestLane(rawEnvLane)) {
      throw new Error(
        `Invalid TZUROT_TEST_LANE "${rawEnvLane}". Allowed values: ${ALLOWED_TEST_LANES.join(', ')}.`
      );
    }
    return {
      lane: rawEnvLane,
      redisDb: TEST_LANE_REDIS_DB[rawEnvLane],
      integrationDbName: integrationDbNameForLane(rawEnvLane),
      source: 'env',
    };
  }

  const checkoutName = basename(checkoutRootOf(opts.rootDir));
  const matchedLane = /^tzurot-([b-e])$/.exec(checkoutName)?.[1];
  const lane: TestLane = matchedLane !== undefined && isTestLane(matchedLane) ? matchedLane : 'a';

  return {
    lane,
    redisDb: TEST_LANE_REDIS_DB[lane],
    integrationDbName: integrationDbNameForLane(lane),
    source: 'path',
  };
}

/**
 * Return `baseUrl` with its pathname replaced by `/<redisDb>`.
 */
export function laneRedisUrl(baseUrl: string, redisDb: number): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${redisDb}`;
  return parsed.toString();
}

/**
 * Resolve the effective `REDIS_URL` for a test run (`packages/test-utils/src/testLane.test.ts`):
 * - Blank or undefined `raw` defaults to `laneRedisUrl('redis://127.0.0.1:6379', redisDb)`.
 * - When `env.CI === 'true'`, returns `raw` unchanged so CI stays byte-identical.
 * - When `raw` has an empty pathname, `/`, or `/0`, rewrites the pathname to `/<redisDb>` via `laneRedisUrl(raw, redisDb)` while preserving host, port, and credentials.
 * - When `raw` has any other explicit DB pathname, returns `raw` unchanged.
 */
export function resolveLaneRedisUrl(opts: {
  raw: string | undefined;
  redisDb: number;
  env: Record<string, string | undefined>;
}): string {
  // Branch 1: blank or undefined `raw` defaults to local Redis on `redisDb` (`testLane.test.ts`).
  if (opts.raw === undefined || opts.raw.trim().length === 0) {
    return laneRedisUrl('redis://127.0.0.1:6379', opts.redisDb);
  }
  // Branch 2: `env.CI === 'true'` keeps `raw` byte-identical (`testLane.test.ts`).
  if (opts.env.CI === 'true') {
    return opts.raw;
  }
  const { pathname } = new URL(opts.raw);
  // Branch 3: empty path, `/`, or `/0` rewrites to `/<redisDb>`, keeping host, port, and credentials (`testLane.test.ts`).
  if (pathname === '' || pathname === '/' || pathname === '/0') {
    return laneRedisUrl(opts.raw, opts.redisDb);
  }
  // Branch 4: any other explicit DB pathname is returned unchanged (`testLane.test.ts`).
  return opts.raw;
}

/**
 * Return the Redis logical DB a test harness should connect to: an explicit
 * non-zero `/N` DB in `raw` wins, matching `resolveLaneRedisUrl`; unset,
 * blank, unparsable, empty-path, `/`, and `/0` values fall back to `laneDb`
 * (`packages/test-utils/src/testLane.test.ts`).
 */
export function redisDbForUrl(raw: string | undefined, laneDb: number): number {
  if (raw === undefined || raw.trim().length === 0) {
    return laneDb;
  }
  let pathname: string;
  try {
    ({ pathname } = new URL(raw));
  } catch {
    return laneDb;
  }
  const match = /^\/(\d+)$/.exec(pathname);
  if (match === null) {
    return laneDb;
  }
  const explicit = Number.parseInt(match[1], 10);
  return explicit === 0 ? laneDb : explicit;
}

/**
 * Walk up from `startDir` (inclusive) to the nearest directory containing
 * `pnpm-workspace.yaml`; returns `startDir` when none is found. `exists` is
 * injectable for tests (`packages/test-utils/src/testLane.test.ts`).
 */
export function findWorkspaceRoot(
  startDir: string,
  exists: (path: string) => boolean = existsSync
): string {
  let current = startDir;
  for (;;) {
    if (exists(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}
