/**
 * Check Prisma Migration Drift
 *
 * Compares migration file checksums against the database to detect drift.
 * Run this when Prisma reports "migration was modified after it was applied".
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

interface MigrationRecord {
  migration_name: string;
  checksum: string;
}

export interface CheckDriftOptions {
  env?: Environment;
  migrationsPath?: string;
}

export async function checkMigrationDrift(options: CheckDriftOptions = {}): Promise<void> {
  const env = options.env ?? 'local';

  // This command requires direct database access via Prisma client
  // For Railway environments, use db:status instead
  if (env !== 'local') {
    console.log(chalk.yellow(`\n⚠️  db:check-drift currently only supports local environment.`));
    console.log(chalk.dim(`\nFor Railway environments, use:`));
    console.log(chalk.cyan(`  pnpm ops db:status --env ${env}`));
    console.log(chalk.dim(`\nThis shows migration status via Prisma CLI.\n`));
    process.exit(0);
  }

  validateEnvironment(env);
  showEnvironmentBanner(env);

  const prisma = getPrismaClient();
  // Default to prisma/migrations relative to cwd (monorepo root)
  const migrationsDir = options.migrationsPath ?? path.join(process.cwd(), 'prisma', 'migrations');

  console.log(chalk.bold('Checking all migrations for drift...\n'));

  try {
    // Get all migrations from database
    const dbMigrations = await prisma.$queryRaw<MigrationRecord[]>`
      SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at
    `;

    let driftCount = 0;
    const driftedMigrations: string[] = [];

    for (const dbMigration of dbMigrations) {
      const migrationName = dbMigration.migration_name;
      const dbChecksum = dbMigration.checksum;

      const filePath = path.join(migrationsDir, migrationName, 'migration.sql');

      if (!fs.existsSync(filePath)) {
        console.log(chalk.yellow(`⚠️  ${migrationName}: File not found (deleted?)`));
        continue;
      }

      // Read file as binary buffer (exactly as Prisma does)
      const fileContent = fs.readFileSync(filePath);
      const fileChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

      if (dbChecksum === fileChecksum) {
        console.log(chalk.green(`✅ ${migrationName}: OK`));
      } else {
        console.log(chalk.red(`❌ ${migrationName}: DRIFT DETECTED`));
        console.log(chalk.dim(`   DB:   ${dbChecksum}`));
        console.log(chalk.dim(`   File: ${fileChecksum}`));
        driftCount++;
        driftedMigrations.push(migrationName);
      }
    }

    console.log(
      `\n${driftCount === 0 ? chalk.green('✅ No drift detected!') : chalk.red(`❌ ${driftCount} migration(s) have drifted.`)}`
    );

    if (driftCount > 0) {
      console.log('\nTo fix, run:');
      console.log(chalk.cyan(`  pnpm ops db:fix-drift ${driftedMigrations.join(' ')}`));
    }
  } finally {
    await disconnectPrisma();
  }
}
