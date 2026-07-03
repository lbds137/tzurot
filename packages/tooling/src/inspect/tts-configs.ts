/**
 * TTS Configs Inspection
 *
 * List all `tts_configs` rows for a given environment. Useful for:
 * - Debugging cross-env ID drift (system-globals + BYOK rows)
 * - Verifying post-migration data alignment (e.g. BYOK TTS config UUID normalization)
 * - Auditing the bot owner's configs against expected state
 */

import chalk from 'chalk';
import { execFileSync } from 'node:child_process';

import { type Environment, getRailwayDatabaseUrl, getRailwayEnvName } from '../utils/env-runner.js';

interface InspectTtsConfigsOptions {
  env: Environment;
}

const TAKE_LIMIT = 200;

/**
 * Build the env vars for executing the inspector against the requested env's DB.
 * For 'local', we use the local DATABASE_URL; for 'dev'/'prod', we fetch the
 * Railway DATABASE_PUBLIC_URL via railway CLI.
 */
function resolveDatabaseUrl(env: Environment): string {
  if (env === 'local') {
    const local = process.env.DATABASE_URL;
    if (local === undefined || local.length === 0) {
      throw new Error('DATABASE_URL not set in local environment');
    }
    return local;
  }
  return getRailwayDatabaseUrl(env);
}

/**
 * Run `tsx` to execute the inspection logic in a child process with the
 * requested environment's DATABASE_URL injected. We do this via subprocess
 * (rather than importing Prisma directly) for two reasons:
 *
 * 1. Prisma's adapter binds to DATABASE_URL at construction time — running
 *    the query in-process would require either re-instantiation or env
 *    mutation, both fragile across multiple inspections.
 * 2. The subprocess pattern matches how other ops commands (db:migrate,
 *    db:status) inject Railway URLs — consistent with the rest of the
 *    tooling package.
 */
export async function inspectTtsConfigs(options: InspectTtsConfigsOptions): Promise<void> {
  const env = options.env;
  if (env !== 'local' && env !== 'dev' && env !== 'prod') {
    throw new Error(`Invalid env: ${String(env)}`);
  }

  const railwayLabel = env === 'local' ? 'LOCAL' : getRailwayEnvName(env).toUpperCase();
  console.log(chalk.cyan(`\n🗄️  Environment: ${railwayLabel}`));
  console.log(chalk.dim('────────────────────────────────────────\n'));

  const databaseUrl = resolveDatabaseUrl(env);
  const inlineScript = buildInspectorScript(TAKE_LIMIT);

  // Run via `tsx -e`. cwd inherits from the parent process — in normal
  // pnpm-workspace usage that's the repo root, where `@tzurot/common-types`
  // resolves via the hoisted `node_modules/`. Invoking from outside the
  // workspace will fail to resolve the import.
  execFileSync('tsx', ['-e', inlineScript], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    cwd: process.cwd(),
  });
}

/**
 * Build the inline tsx script that runs against the supplied DATABASE_URL.
 * Kept pure (no closures over caller state) so the output is deterministic
 * and easy to test.
 */
export function buildInspectorScript(takeLimit: number): string {
  return `
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';

async function main() {
  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });
  try {
    const rows = await prisma.ttsConfig.findMany({
      select: { id: true, ownerId: true, name: true, isGlobal: true, provider: true },
      orderBy: [{ name: 'asc' }],
      take: ${takeLimit},
    });
    for (const r of rows) {
      const owner = r.ownerId.slice(0, 8);
      const global = r.isGlobal ? 'Y' : 'N';
      const provider = r.provider.padEnd(12);
      console.log(\`\${r.id}  owner=\${owner}..  global=\${global}  provider=\${provider}  name=\${r.name}\`);
    }
    console.log(\`\\nTotal: \${rows.length} rows\`);
    if (rows.length === ${takeLimit}) {
      console.warn('⚠️  Result may be truncated at the ' + ${takeLimit} + '-row take limit — re-run with a higher limit if you need to see all rows');
    }
  } finally {
    await dispose().catch(() => undefined);
  }
}

await main();
`.trim();
}
