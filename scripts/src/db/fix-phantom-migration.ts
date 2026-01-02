/**
 * Fix Phantom Migration
 *
 * Cleans up a migration that failed and is causing Prisma to be confused.
 *
 * @usage DATABASE_URL="..." pnpm --filter @tzurot/scripts run db:fix-phantom -- <migration_name>
 */

import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

const migrationName = process.argv[2] || '20260102050920_add_image_description_cache';

async function main() {
  const prisma = getPrismaClient();

  console.log(`\n🔍 Checking for migration: ${migrationName}...\n`);

  // 1. Check if it exists
  const existing = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT migration_name, finished_at, rolled_back_at
    FROM _prisma_migrations
    WHERE migration_name = ${migrationName}
  `;

  console.log('Found records:', existing);

  if (existing.length > 0) {
    // 2. Delete it
    await prisma.$queryRaw`
      DELETE FROM _prisma_migrations WHERE migration_name = ${migrationName}
    `;
    console.log(`\n✅ Successfully deleted ${migrationName} from _prisma_migrations table.`);
  } else {
    console.log('\n⚠️  Record not found in _prisma_migrations.');
  }

  // 3. Also list recent migrations to verify state
  const recent = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5
  `;
  console.log('\n📋 Recent migrations:', recent.map(r => r.migration_name));

  await disconnectPrisma();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectPrisma();
  process.exit(1);
});
