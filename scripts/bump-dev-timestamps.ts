/**
 * Bump All Personality Timestamps in Dev Database
 *
 * Updates updated_at to current time for all personalities in dev database.
 * This ensures dev personalities win conflicts during db-sync to prod,
 * preserving appearance fields, customFields, and BYTEA avatars.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/bump-dev-timestamps.ts
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable required');
    console.error('Usage: DATABASE_URL="postgresql://..." npx tsx scripts/bump-dev-timestamps.ts');
    process.exit(1);
  }

  console.log('🔄 Bumping all personality timestamps in dev database\n');

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    // Get count of personalities
    const count = await prisma.personality.count();
    console.log(`📊 Found ${count} personalities\n`);

    if (count === 0) {
      console.log('⚠️  No personalities found in database');
      return;
    }

    // Bump all timestamps to now
    const now = new Date();
    console.log(`⏰ Updating all timestamps to: ${now.toISOString()}`);

    const result = await prisma.personality.updateMany({
      data: {
        updatedAt: now,
      },
    });

    console.log(`\n✅ Updated ${result.count} personalities`);

    // Show some examples
    console.log('\n📋 Sample of updated personalities:');
    const samples = await prisma.personality.findMany({
      take: 10,
      orderBy: { name: 'asc' },
      select: {
        slug: true,
        name: true,
        updatedAt: true,
      },
    });

    samples.forEach(p => {
      console.log(`   - ${p.name} (${p.slug}): ${p.updatedAt.toISOString()}`);
    });

    console.log('\n✨ Timestamp bump complete!');
    console.log('\n📋 Next steps:');
    console.log('   1. Deploy schema migrations to prod');
    console.log('   2. Run db-sync from dev → prod');
    console.log('   3. Dev personalities will win conflicts due to newer timestamps');
    console.log('   4. This preserves appearance fields, customFields, and BYTEA avatars');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
