/**
 * Fix Prisma migration checksums
 *
 * When migration files are modified after being applied, Prisma complains about checksum mismatches.
 * This script recalculates checksums and updates the _prisma_migrations table.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getPrismaClient } from '@tzurot/common-types';

const migrations = [
  '20251107130153_convert_discord_message_id_to_array',
  '20251117153407_add_hnsw_index_to_memories',
];

async function fixChecksums() {
  const prisma = getPrismaClient();

  for (const migrationName of migrations) {
    const migrationPath = join(
      process.cwd(),
      'prisma',
      'migrations',
      migrationName,
      'migration.sql'
    );

    // Read migration file and calculate checksum
    const content = readFileSync(migrationPath, 'utf-8');
    const checksum = createHash('sha256').update(content).digest('hex');

    console.log(`Migration: ${migrationName}`);
    console.log(`New checksum: ${checksum}`);

    // Update checksum in database
    await prisma.$executeRawUnsafe(
      `
      UPDATE "_prisma_migrations"
      SET "checksum" = $1
      WHERE "migration_name" = $2
    `,
      checksum,
      migrationName
    );

    console.log('✓ Updated\n');
  }

  await prisma.$disconnect();
  console.log('All checksums fixed!');
}

fixChecksums().catch(console.error);
