/**
 * Fix Prisma Migration Drift
 *
 * Updates migration checksums in the database to match the current file contents.
 * Use this when Prisma reports "migration was modified after it was applied".
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function fixMigrationDrift(migrationNames?: string[]): Promise<void> {
  const prisma = getPrismaClient();
  // Navigate from packages/tooling/dist/db to project root
  const migrationsDir = path.join(__dirname, '..', '..', '..', '..', 'prisma', 'migrations');

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
