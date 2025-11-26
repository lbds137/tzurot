/**
 * Sprint 2 Data Migration Script
 *
 * Handles data migration tasks for BYOK schema changes:
 * - Task 2.7: Migrate errorMessage from custom_fields → dedicated column
 * - Task 2.8: Extract aliases from display names → PersonalityAlias table
 * - Task 2.9: Import birthdays from shapes.inc → birthday column
 * - Task 2.10: Assign ownership to existing personalities
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/migrations/sprint2-data-migration.ts [--dry-run] [--verbose]
 *   railway run npx tsx scripts/migrations/sprint2-data-migration.ts [--dry-run] [--verbose]
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPrismaClient, type PrismaClient } from '@tzurot/common-types';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const TASK = args.find(a => a.startsWith('--task='))?.split('=')[1] || 'all';

const log = (msg: string) => console.log(msg);
const debug = (msg: string) => VERBOSE && console.log(`  [DEBUG] ${msg}`);

// Shapes.inc backup location
const SHAPES_BACKUP_DIR = 'tzurot-legacy/data/personalities';

interface ShapesIncConfig {
  id: string;
  name: string;
  username: string; // slug
  birthday?: string | null;
  error_message?: string;
}

/**
 * Task 2.7: Migrate errorMessage from custom_fields to dedicated column
 */
async function migrateErrorMessages(prisma: PrismaClient): Promise<number> {
  log('\n📋 Task 2.7: Migrating errorMessage from custom_fields...');

  // Find personalities with errorMessage in custom_fields but not in dedicated column
  const personalities = await prisma.personality.findMany({
    where: {
      errorMessage: null,
    },
    select: {
      id: true,
      name: true,
      customFields: true,
    },
  });

  let migratedCount = 0;
  for (const p of personalities) {
    const customFields = p.customFields as Record<string, unknown> | null;
    const errorMessage = customFields?.errorMessage as string | undefined;

    if (errorMessage) {
      debug(`Found errorMessage in custom_fields for ${p.name}: "${errorMessage.slice(0, 50)}..."`);

      if (!DRY_RUN) {
        await prisma.personality.update({
          where: { id: p.id },
          data: { errorMessage },
        });
      }
      migratedCount++;
    }
  }

  log(
    `  ✅ ${DRY_RUN ? 'Would migrate' : 'Migrated'} ${migratedCount} personalities with errorMessage`
  );
  return migratedCount;
}

/**
 * Task 2.8: Extract aliases from display names
 *
 * Creates aliases for personality lookup. Examples:
 * - "Lilith" → alias "lilith" for personality "lila-ani-tzuratech"
 * - "COLD" → alias "cold" for personality "cold-kerach-batuach"
 */
async function createAliasesFromDisplayNames(prisma: PrismaClient): Promise<number> {
  log('\n📋 Task 2.8: Creating aliases from display names...');

  const personalities = await prisma.personality.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
    },
  });

  let createdCount = 0;
  for (const p of personalities) {
    // Generate potential aliases from name and displayName
    const aliases = new Set<string>();

    // Add lowercase name as alias (e.g., "Lilith" → "lilith")
    if (p.name) {
      aliases.add(p.name.toLowerCase());
    }

    // Add lowercase displayName as alias if different
    if (p.displayName && p.displayName.toLowerCase() !== p.name?.toLowerCase()) {
      aliases.add(p.displayName.toLowerCase());
    }

    // Skip if alias would be same as slug (redundant)
    aliases.delete(p.slug);

    for (const alias of Array.from(aliases)) {
      // Check if alias already exists
      const existing = await prisma.personalityAlias.findFirst({
        where: { alias },
      });

      if (existing) {
        debug(`Alias "${alias}" already exists for personality ${existing.personalityId}`);
        continue;
      }

      debug(`Creating alias "${alias}" for ${p.name} (${p.slug})`);

      if (!DRY_RUN) {
        try {
          await prisma.personalityAlias.create({
            data: {
              personalityId: p.id,
              alias,
            },
          });
          createdCount++;
        } catch (err) {
          // Ignore duplicate key errors (race condition protection)
          if ((err as Error).message.includes('Unique constraint')) {
            debug(`Alias "${alias}" created by concurrent process`);
          } else {
            throw err;
          }
        }
      } else {
        createdCount++;
      }
    }
  }

  log(`  ✅ ${DRY_RUN ? 'Would create' : 'Created'} ${createdCount} aliases`);
  return createdCount;
}

/**
 * Task 2.9: Import birthdays from shapes.inc backups
 */
async function importBirthdaysFromShapesInc(prisma: PrismaClient): Promise<number> {
  log('\n📋 Task 2.9: Importing birthdays from shapes.inc backups...');

  const backupDir = path.join(process.cwd(), SHAPES_BACKUP_DIR);

  let dirs: string[];
  try {
    dirs = await fs.readdir(backupDir);
  } catch {
    log('  ⚠️  No shapes.inc backup directory found, skipping birthday import');
    return 0;
  }

  let importedCount = 0;
  const birthdaysFound: { slug: string; birthday: string }[] = [];

  for (const dir of dirs) {
    const configPath = path.join(backupDir, dir, `${dir}.json`);

    try {
      const configRaw = await fs.readFile(configPath, 'utf-8');
      const config: ShapesIncConfig = JSON.parse(configRaw);

      if (config.birthday) {
        birthdaysFound.push({ slug: config.username, birthday: config.birthday });
        debug(`Found birthday for ${config.name}: ${config.birthday}`);
      }
    } catch {
      // Skip if config doesn't exist or is invalid
      continue;
    }
  }

  log(`  Found ${birthdaysFound.length} personalities with birthdays in shapes.inc`);

  for (const { slug, birthday } of birthdaysFound) {
    // Find matching personality in v3 database
    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: { id: true, name: true, birthday: true },
    });

    if (!personality) {
      debug(`No matching v3 personality for slug: ${slug}`);
      continue;
    }

    if (personality.birthday) {
      debug(`${personality.name} already has birthday set: ${personality.birthday}`);
      continue;
    }

    debug(`Setting birthday for ${personality.name}: ${birthday}`);

    if (!DRY_RUN) {
      await prisma.personality.update({
        where: { id: personality.id },
        data: { birthday },
      });
    }
    importedCount++;
  }

  log(`  ✅ ${DRY_RUN ? 'Would import' : 'Imported'} ${importedCount} birthdays`);
  return importedCount;
}

/**
 * Task 2.10: Assign ownership to existing personalities
 *
 * Sets the bot owner (superuser) as owner of all personalities that don't have an owner.
 */
async function assignPersonalityOwnership(prisma: PrismaClient): Promise<number> {
  log('\n📋 Task 2.10: Assigning ownership to existing personalities...');

  // Find the superuser (bot owner)
  const superuser = await prisma.user.findFirst({
    where: { isSuperuser: true },
    select: { id: true, discordId: true },
  });

  if (!superuser) {
    log('  ⚠️  No superuser found. Run user registration first or manually set isSuperuser=true');
    return 0;
  }

  log(`  Found superuser: Discord ID ${superuser.discordId}`);

  // Find personalities without an owner
  const unownedPersonalities = await prisma.personality.findMany({
    where: { ownerId: null },
    select: { id: true, name: true },
  });

  if (unownedPersonalities.length === 0) {
    log('  ✅ All personalities already have owners');
    return 0;
  }

  log(`  Found ${unownedPersonalities.length} personalities without owners`);

  if (!DRY_RUN) {
    await prisma.personality.updateMany({
      where: { ownerId: null },
      data: { ownerId: superuser.id },
    });
  }

  for (const p of unownedPersonalities) {
    debug(`Assigned ${p.name} to superuser`);
  }

  log(
    `  ✅ ${DRY_RUN ? 'Would assign' : 'Assigned'} ${unownedPersonalities.length} personalities to superuser`
  );
  return unownedPersonalities.length;
}

/**
 * Main entry point
 */
async function main() {
  log('═'.repeat(70));
  log('Sprint 2 Data Migration');
  log('═'.repeat(70));
  log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '✏️  LIVE (will modify database)'}`);
  log(`Task: ${TASK}`);
  log(`Verbose: ${VERBOSE}`);

  const prisma = getPrismaClient();

  try {
    const results = {
      errorMessages: 0,
      aliases: 0,
      birthdays: 0,
      ownership: 0,
    };

    if (TASK === 'all' || TASK === '2.7') {
      results.errorMessages = await migrateErrorMessages(prisma);
    }

    if (TASK === 'all' || TASK === '2.8') {
      results.aliases = await createAliasesFromDisplayNames(prisma);
    }

    if (TASK === 'all' || TASK === '2.9') {
      results.birthdays = await importBirthdaysFromShapesInc(prisma);
    }

    if (TASK === 'all' || TASK === '2.10') {
      results.ownership = await assignPersonalityOwnership(prisma);
    }

    log('\n═'.repeat(70));
    log('Summary');
    log('═'.repeat(70));
    log(`  Error messages migrated: ${results.errorMessages}`);
    log(`  Aliases created: ${results.aliases}`);
    log(`  Birthdays imported: ${results.birthdays}`);
    log(`  Personalities assigned: ${results.ownership}`);
    log('');
    if (DRY_RUN) {
      log('🔍 DRY RUN COMPLETE - No changes were made');
      log('   Run without --dry-run to apply changes');
    } else {
      log('✅ MIGRATION COMPLETE');
    }
    log('═'.repeat(70));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
