/**
 * Test Lane Inspector and Local Integration DB Provisioner (`pnpm ops test:lane`)
 *
 * Prints the checkout's resolved test lane (`a`..`e`), resolution source
 * (`env` vs `path`), Redis logical DB index, and integration database name.
 * With `--provision`, creates the lane's integration database in the local
 * `tzurot-postgres` container if absent and enables the project's required
 * extensions (`vector`, `citext`).
 */

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import {
  checkoutRootOf,
  findWorkspaceRoot,
  resolveTestLane,
  type TestLane,
} from '@tzurot/test-utils/testLane';

const SAFE_DB_NAME_PATTERN = /^[a-z0-9_]+$/;
const POSTGRES_CONTAINER = 'tzurot-postgres';
const POSTGRES_USER = 'tzurot';

/**
 * Validate an integration database name before passing it to `psql` or `createdb`.
 */
export function validateIntegrationDbName(dbName: string): void {
  if (!SAFE_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `Invalid integration database name "${dbName}": must match ${SAFE_DB_NAME_PATTERN.source}`
    );
  }
}

/**
 * Ensure `dbName` exists in the local `tzurot-postgres` container and has
 * `vector` and `citext` extensions enabled.
 */
export function provisionLaneDatabase(dbName: string): { created: boolean } {
  validateIntegrationDbName(dbName);

  const existing = execFileSync(
    'podman',
    [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-U',
      POSTGRES_USER,
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`,
    ],
    { encoding: 'utf-8' }
  ).trim();

  const created = existing !== '1';
  if (created) {
    execFileSync('podman', ['exec', POSTGRES_CONTAINER, 'createdb', '-U', POSTGRES_USER, dbName], {
      encoding: 'utf-8',
    });
  }

  execFileSync(
    'podman',
    [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-U',
      POSTGRES_USER,
      '-d',
      dbName,
      '-c',
      'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext',
    ],
    { encoding: 'utf-8' }
  );

  console.log(
    created
      ? `Created integration database "${dbName}" in ${POSTGRES_CONTAINER} and enabled extensions (vector, citext).`
      : `Integration database "${dbName}" already exists in ${POSTGRES_CONTAINER}; ensured extensions (vector, citext).`
  );
  console.log(
    `Next step, in one line (README.md § Local Development's URL with database "${dbName}"): DATABASE_URL=<that URL> pnpm ops db:migrate`
  );

  return { created };
}

export interface TestLaneCommandOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  provision?: boolean;
}

export interface ResolvedLaneReport {
  lane: TestLane;
  source: 'env' | 'path';
  redisDb: number;
  integrationDbName: string;
  created?: boolean;
}

/**
 * CLI entry point for `pnpm ops test:lane`.
 */
export function runTestLane(options: TestLaneCommandOptions = {}): ResolvedLaneReport {
  const rootDir = options.rootDir ?? findWorkspaceRoot(process.cwd());
  const env = options.env ?? process.env;
  const resolved = resolveTestLane({ rootDir, env });

  console.log(`Test lane:           ${resolved.lane} (source: ${resolved.source})`);
  console.log(`Redis DB index:      ${resolved.redisDb}`);
  console.log(`Integration DB name: ${resolved.integrationDbName}`);

  const checkoutName = basename(checkoutRootOf(rootDir));
  if (
    resolved.source === 'path' &&
    resolved.lane === 'a' &&
    /^tzurot/i.test(checkoutName) &&
    checkoutName.toLowerCase() !== 'tzurot'
  ) {
    console.warn(
      `Warning: checkout "${checkoutName}" did not match tzurot-b..tzurot-e and shares lane a with the main clone; export TZUROT_TEST_LANE=b..e to isolate.`
    );
  }

  if (options.provision === true) {
    const { created } = provisionLaneDatabase(resolved.integrationDbName);
    return { ...resolved, created };
  }

  return resolved;
}
