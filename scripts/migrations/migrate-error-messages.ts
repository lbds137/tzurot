#!/usr/bin/env tsx
/**
 * Data Migration: Move custom_fields.errorMessage → Personality.errorMessage
 *
 * This script migrates the errorMessage from the JSONB custom_fields column
 * to the new dedicated error_message column.
 *
 * Run with: npx tsx scripts/migrations/migrate-error-messages.ts
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 *   --verbose    Show detailed output for each personality
 */

import { createPrismaClient, DB_POOL_DEFAULTS } from '@tzurot/common-types';

const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });

interface CustomFields {
  errorMessage?: string;
  [key: string]: unknown;
}

async function migrateErrorMessages(dryRun: boolean, verbose: boolean): Promise<void> {
  console.log(`\n🚀 Starting errorMessage migration${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // Find all personalities with errorMessage in custom_fields
  const personalities = await prisma.personality.findMany({
    select: {
      id: true,
      name: true,
      customFields: true,
      errorMessage: true,
    },
  });

  console.log(`📊 Found ${personalities.length} total personalities\n`);

  let migratedCount = 0;
  let skippedCount = 0;
  let alreadyMigratedCount = 0;

  for (const personality of personalities) {
    const customFields = personality.customFields as CustomFields | null;
    const existingErrorMessage = customFields?.errorMessage;

    if (!existingErrorMessage) {
      if (verbose) {
        console.log(`⏭️  ${personality.name}: No errorMessage in custom_fields`);
      }
      skippedCount++;
      continue;
    }

    // Check if already migrated (errorMessage column already has value)
    if (personality.errorMessage) {
      if (verbose) {
        console.log(`✅ ${personality.name}: Already migrated (error_message column already set)`);
      }
      alreadyMigratedCount++;
      continue;
    }

    // Migrate the errorMessage
    if (verbose || !dryRun) {
      console.log(`📝 ${personality.name}: Migrating errorMessage`);
      if (verbose) {
        console.log(`   Value: "${existingErrorMessage.substring(0, 50)}..."`);
      }
    }

    if (!dryRun) {
      // Update the error_message column
      await prisma.personality.update({
        where: { id: personality.id },
        data: {
          errorMessage: existingErrorMessage,
        },
      });

      // Optionally remove from custom_fields (keep it for now for safety)
      // If you want to clean up custom_fields later, uncomment this:
      // const newCustomFields = { ...customFields };
      // delete newCustomFields.errorMessage;
      // await prisma.personality.update({
      //   where: { id: personality.id },
      //   data: { customFields: newCustomFields },
      // });
    }

    migratedCount++;
  }

  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✅ Migrated: ${migratedCount}`);
  console.log(`   ⏭️  Skipped (no errorMessage): ${skippedCount}`);
  console.log(`   ✅ Already migrated: ${alreadyMigratedCount}`);
  console.log(`   📦 Total: ${personalities.length}`);

  if (dryRun) {
    console.log(`\n⚠️  This was a DRY RUN. No changes were made.`);
    console.log(`   Run without --dry-run to apply changes.\n`);
  } else {
    console.log(`\n✅ Migration complete!\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  try {
    await migrateErrorMessages(dryRun, verbose);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await dispose();
  }
}

main();
