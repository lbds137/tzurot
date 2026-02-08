/**
 * Fix Prisma Migration Drift
 *
 * Updates migration checksums in the database to match the current file contents.
 * Use this when Prisma reports "migration was modified after it was applied".
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import chalk from 'chalk';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
} from '../utils/env-runner.js';

interface FixDriftOptions {
  env?: Environment;
  migrationsPath?: string;
}

export async function fixMigrationDrift(
  migrationNames?: string[],
  options: FixDriftOptions = {}
): Promise<void> {
  const env = options.env ?? 'local';

  // This command requires direct database access via Prisma client
  // For Railway environments, manual intervention is needed
  if (env !== 'local') {
    console.log(chalk.yellow(`\n⚠️  db:fix-drift currently only supports local environment.`));
    console.log(chalk.dim(`\nFor Railway environments, you have two options:`));
    console.log(chalk.dim(`  1. Connect directly via Railway dashboard → PostgreSQL → Connect`));
    console.log(chalk.dim(`  2. Use: railway run psql -c "UPDATE _prisma_migrations SET ..."`));
    console.log(chalk.dim(`\nFirst, check current status:`));
    console.log(chalk.cyan(`  pnpm ops db:status --env ${env}\n`));
    process.exit(0);
  }

  validateEnvironment(env);
  showEnvironmentBanner(env);

  const prisma = getPrismaClient();
  // Default to prisma/migrations relative to cwd (monorepo root)
  const migrationsDir = options.migrationsPath ?? path.join(process.cwd(), 'prisma', 'migrations');

  const names = migrationNames ?? process.argv.slice(2).filter(arg => arg !== '--');

  if (names.length === 0) {
    console.log(chalk.yellow('Usage: pnpm ops db:fix-drift <migration_name> [...]'));
    console.log('\nTo see which migrations have drifted:');
    console.log(chalk.cyan('  pnpm ops db:check-drift'));
    return;
  }

  console.log(chalk.bold(`Fixing ${names.length} migration(s)...\n`));

  try {
    for (const migrationName of names) {
      const filePath = path.join(migrationsDir, migrationName, 'migration.sql');

      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`❌ ${migrationName}: File not found at ${filePath}`));
        continue;
      }

      // Read file as binary buffer (exactly as Prisma does)
      const fileContent = fs.readFileSync(filePath);

      // Calculate SHA-256 exactly as Prisma does
      const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');

      console.log(`Migration: ${migrationName}`);
      console.log(chalk.dim(`Checksum:  ${checksum}`));

      // Update the database
      const result = await prisma.$executeRaw`
        UPDATE _prisma_migrations
        SET checksum = ${checksum}
        WHERE migration_name = ${migrationName}
      `;

      if (result === 1) {
        console.log(chalk.green(`✅ Updated successfully\n`));
      } else if (result === 0) {
        console.log(chalk.yellow(`⚠️  No rows updated (migration not in database?)\n`));
      } else {
        console.log(`Updated ${result} rows\n`);
      }
    }

    console.log(chalk.green('Done!') + ' Run `npx prisma migrate status` to verify.');
  } finally {
    await disconnectPrisma();
  }
}
