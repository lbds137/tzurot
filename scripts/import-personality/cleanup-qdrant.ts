/**
 * Qdrant Cleanup CLI
 *
 * Scans Qdrant collections for memories with old/incomplete metadata
 * and migrates them to v3 standard format.
 *
 * Usage:
 *   pnpm cleanup-qdrant --dry-run        # Scan and report without making changes
 *   pnpm cleanup-qdrant                  # Scan and migrate
 *   pnpm cleanup-qdrant --collection persona-{uuid}  # Migrate specific collection
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { PrismaClient } from '@prisma/client';
import { QdrantMigrator } from './QdrantMigrator.js';
import { getConfig } from '@tzurot/common-types';

const config = getConfig();

// Orphaned persona ID (where memories without persona assignment go)
const ORPHANED_PERSONA_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  console.log('🚀 Qdrant Cleanup Tool');
  console.log('═'.repeat(80));
  console.log('');

  // Parse command-line args
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const collectionArg = args.find(arg => arg.startsWith('--collection='));
  const specificCollection = collectionArg?.split('=')[1];

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Initialize clients
  const qdrant = new QdrantClient({
    url: config.QDRANT_URL,
    apiKey: config.QDRANT_API_KEY,
  });

  const prisma = new PrismaClient();

  // Create migrator
  const migrator = new QdrantMigrator({
    qdrant,
    prisma,
    orphanedPersonaId: ORPHANED_PERSONA_ID,
    dryRun,
  });

  try {
    // Scan for issues
    console.log('Step 1: Scanning for migration issues\n');
    const issues = await migrator.scan();

    // Filter to specific collection if requested
    const filteredIssues = specificCollection
      ? issues.filter(i => i.collectionName === specificCollection)
      : issues;

    if (filteredIssues.length === 0) {
      console.log('✅ No migration issues found!\n');
      console.log(migrator.generateReport([]));
      return;
    }

    console.log(`Found ${filteredIssues.length} memories needing migration\n`);

    // Show sample issues
    console.log('📋 Sample Issues:');
    for (const issue of filteredIssues.slice(0, 5)) {
      console.log(`\n  Memory: ${issue.memoryId} (${issue.collectionName})`);
      console.log(`  Issues: ${issue.issues.join(', ')}`);
      console.log(`  Current metadata:`, JSON.stringify(issue.currentMetadata, null, 4));
      console.log(`  Suggested fix:`, JSON.stringify(issue.suggestedFix, null, 4));
    }

    if (filteredIssues.length > 5) {
      console.log(`\n  ... and ${filteredIssues.length - 5} more\n`);
    }

    if (dryRun) {
      console.log('\n🔍 DRY RUN - Skipping migration. Run without --dry-run to apply fixes.\n');
      console.log(migrator.generateReport(filteredIssues));
      return;
    }

    // Ask for confirmation (in a real CLI, you'd use a prompt library)
    console.log('\n⚠️  About to migrate', filteredIssues.length, 'memories');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Migrate
    console.log('Step 2: Migrating memories\n');
    const result = await migrator.migrate(filteredIssues);

    // Show report
    console.log('\n' + migrator.generateReport(filteredIssues));

    if (result.failed > 0) {
      console.log('\n⚠️  Some migrations failed. Check errors above.');
      process.exit(1);
    } else {
      console.log('\n✅ All migrations completed successfully!');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
