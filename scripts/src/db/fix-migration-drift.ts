/**
 * Fix Prisma Migration Drift
 *
 * Updates migration checksums in the database to match the current file contents.
 * Use this when Prisma reports "migration was modified after it was applied".
 *
 * @usage pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name> [<migration_name> ...]
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const migrationsDir = path.join(__dirname, '..', '..', '..', 'prisma', 'migrations');

  // Get migration names from CLI args (filter out -- separator)
  const migrationNames = process.argv.slice(2).filter(arg => arg !== '--');

  if (migrationNames.length === 0) {
    console.log('Usage: pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name> [...]');
    console.log('\nTo see which migrations have drifted:');
    console.log('  pnpm --filter @tzurot/scripts run db:check-drift');
    process.exit(1);
  }

  console.log(`Fixing ${migrationNames.length} migration(s)...\n`);

  for (const migrationName of migrationNames) {
    const filePath = path.join(migrationsDir, migrationName, 'migration.sql');

    if (!fs.existsSync(filePath)) {
      console.error(`❌ ${migrationName}: File not found at ${filePath}`);
      continue;
    }

    // Read file as binary buffer (exactly as Prisma does)
    const fileContent = fs.readFileSync(filePath);

    // Calculate SHA-256 exactly as Prisma does
    const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');

    console.log(`Migration: ${migrationName}`);
    console.log(`Checksum:  ${checksum}`);

    // Update the database
    const result = await prisma.$executeRaw`
      UPDATE _prisma_migrations
      SET checksum = ${checksum}
      WHERE migration_name = ${migrationName}
    `;

    if (result === 1) {
      console.log(`✅ Updated successfully\n`);
    } else if (result === 0) {
      console.log(`⚠️  No rows updated (migration not in database?)\n`);
    } else {
      console.log(`Updated ${result} rows\n`);
    }
  }

  console.log('Done! Run `npx prisma migrate status` to verify.');
}

main()
  .catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
