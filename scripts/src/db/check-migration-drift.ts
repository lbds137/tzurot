/**
 * Check Prisma Migration Drift
 *
 * Compares migration file checksums against the database to detect drift.
 * Run this when Prisma reports "migration was modified after it was applied".
 *
 * @usage pnpm --filter @tzurot/scripts run db:check-drift
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MigrationRecord {
  migration_name: string;
  checksum: string;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const migrationsDir = path.join(__dirname, '..', '..', '..', 'prisma', 'migrations');

  console.log('Checking all migrations for drift...\n');

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
      console.log(`⚠️  ${migrationName}: File not found (deleted?)`);
      continue;
    }

    // Read file as binary buffer (exactly as Prisma does)
    const fileContent = fs.readFileSync(filePath);
    const fileChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

    if (dbChecksum === fileChecksum) {
      console.log(`✅ ${migrationName}: OK`);
    } else {
      console.log(`❌ ${migrationName}: DRIFT DETECTED`);
      console.log(`   DB:   ${dbChecksum}`);
      console.log(`   File: ${fileChecksum}`);
      driftCount++;
      driftedMigrations.push(migrationName);
    }
  }

  console.log(
    `\n${driftCount === 0 ? '✅ No drift detected!' : `❌ ${driftCount} migration(s) have drifted.`}`
  );

  if (driftCount > 0) {
    console.log('\nTo fix, run:');
    console.log(
      `  pnpm --filter @tzurot/scripts run db:fix-drift -- ${driftedMigrations.join(' ')}`
    );
  }
}

main()
  .catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
