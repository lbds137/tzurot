/**
 * Migrate Legacy Persona CLI
 *
 * Migrates memories from a legacy shapes.inc persona collection to a v3 user's persona.
 *
 * Usage:
 *   pnpm migrate-legacy-persona {shapesUserId} {discordId} [options]
 *   pnpm migrate-legacy-persona {shapesUserId} --user-id {v3UserId} [options]
 *
 * Examples:
 *   # Migrate by Discord ID (most common)
 *   pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 278863839632818186
 *
 *   # Migrate by v3 user ID
 *   pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 --user-id e64fcc09-e4db-5902-b1c9-5750141e3bf2
 *
 *   # Dry run (preview migration)
 *   pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 278863839632818186 --dry-run
 *
 *   # Keep legacy collection after migration
 *   pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 278863839632818186 --keep-legacy
 */

import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAI } from 'openai';
import { getConfig } from '@tzurot/common-types';

const config = getConfig();

interface MigrationOptions {
  shapesUserId: string;
  discordId?: string;
  v3UserId?: string;
  dryRun: boolean;
  keepLegacy: boolean;
}

interface MigrationResult {
  memoriesMigrated: number;
  legacyCollectionDeleted: boolean;
  targetPersonaId: string;
  errors: { memoryId: string; error: string }[];
}

class LegacyPersonaMigration {
  private prisma: PrismaClient;
  private qdrant: QdrantClient;

  constructor() {
    this.prisma = new PrismaClient();
    this.qdrant = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
    });
  }

  /**
   * Main migration flow
   */
  async migrate(options: MigrationOptions): Promise<MigrationResult> {
    console.log('\n🔄 Legacy Persona Migration Tool');
    console.log('═'.repeat(80));
    console.log(`\nShapes.inc User ID: ${options.shapesUserId}`);
    console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
    console.log(`Keep legacy collection: ${options.keepLegacy}\n`);

    const result: MigrationResult = {
      memoriesMigrated: 0,
      legacyCollectionDeleted: false,
      targetPersonaId: '',
      errors: [],
    };

    try {
      // Step 1: Resolve v3 user and persona
      console.log('Step 1: Resolving v3 user and persona\n');
      const { userId, personaId } = await this.resolveUser(options);
      result.targetPersonaId = personaId;

      console.log(`✅ User resolved:`);
      console.log(`  V3 User ID: ${userId}`);
      console.log(`  V3 Persona ID: ${personaId}\n`);

      // Step 2: Check legacy collection exists
      console.log('Step 2: Checking legacy collection\n');
      const legacyCollectionName = `persona-legacy-${options.shapesUserId}`;
      const legacyExists = await this.checkCollectionExists(legacyCollectionName);

      if (!legacyExists) {
        throw new Error(`Legacy collection ${legacyCollectionName} does not exist`);
      }

      const memoryCount = await this.getCollectionSize(legacyCollectionName);
      console.log(`✅ Found legacy collection: ${legacyCollectionName}`);
      console.log(`  Memories to migrate: ${memoryCount}\n`);

      if (memoryCount === 0) {
        console.log('⚠️  No memories to migrate\n');
        return result;
      }

      // Step 3: Migrate memories
      console.log('Step 3: Migrating memories\n');
      if (options.dryRun) {
        console.log(`🔍 [DRY RUN] Would migrate ${memoryCount} memories`);
        console.log(`   From: ${legacyCollectionName}`);
        console.log(`   To: persona-${personaId}\n`);
        result.memoriesMigrated = memoryCount;
      } else {
        result.memoriesMigrated = await this.migrateMemories(
          legacyCollectionName,
          personaId,
          result.errors
        );

        console.log(`✅ Migrated ${result.memoriesMigrated} memories\n`);
      }

      // Step 4: Delete legacy collection (if requested)
      if (!options.keepLegacy && result.memoriesMigrated > 0) {
        console.log('Step 4: Cleaning up legacy collection\n');
        if (options.dryRun) {
          console.log(`🔍 [DRY RUN] Would delete collection: ${legacyCollectionName}\n`);
        } else {
          await this.qdrant.deleteCollection(legacyCollectionName);
          result.legacyCollectionDeleted = true;
          console.log(`✅ Deleted legacy collection: ${legacyCollectionName}\n`);
        }
      } else if (options.keepLegacy) {
        console.log(`ℹ️  Keeping legacy collection (--keep-legacy flag)\n`);
      }

      // Done!
      console.log('═'.repeat(80));
      if (options.dryRun) {
        console.log('✅ DRY RUN COMPLETE - No changes were made');
      } else {
        console.log('✅ MIGRATION COMPLETE');
      }
      console.log('═'.repeat(80));
      console.log('');

      if (result.errors.length > 0) {
        console.log('⚠️  Errors encountered:');
        result.errors.forEach(e => {
          console.log(`  ${e.memoryId}: ${e.error}`);
        });
        console.log('');
      }
    } catch (error) {
      console.error('\n❌ Migration failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }

    return result;
  }

  /**
   * Resolve v3 user by Discord ID or user ID
   */
  private async resolveUser(
    options: MigrationOptions
  ): Promise<{ userId: string; personaId: string }> {
    let user;

    if (options.discordId) {
      user = await this.prisma.user.findUnique({
        where: { discordId: options.discordId },
        include: {
          defaultPersonaLink: {
            select: { personaId: true },
          },
        },
      });

      if (!user) {
        throw new Error(`User with Discord ID ${options.discordId} not found`);
      }
    } else if (options.v3UserId) {
      user = await this.prisma.user.findUnique({
        where: { id: options.v3UserId },
        include: {
          defaultPersonaLink: {
            select: { personaId: true },
          },
        },
      });

      if (!user) {
        throw new Error(`User with ID ${options.v3UserId} not found`);
      }
    } else {
      throw new Error('Must provide either Discord ID or v3 user ID');
    }

    if (!user.defaultPersonaLink) {
      throw new Error(`User ${user.id} has no default persona`);
    }

    return {
      userId: user.id,
      personaId: user.defaultPersonaLink.personaId,
    };
  }

  /**
   * Check if collection exists
   */
  private async checkCollectionExists(collectionName: string): Promise<boolean> {
    try {
      await this.qdrant.getCollection(collectionName);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get collection size
   */
  private async getCollectionSize(collectionName: string): Promise<number> {
    try {
      const collection = await this.qdrant.getCollection(collectionName);
      return collection.points_count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Migrate memories from legacy collection to v3 persona collection
   */
  private async migrateMemories(
    legacyCollectionName: string,
    targetPersonaId: string,
    errors: { memoryId: string; error: string }[]
  ): Promise<number> {
    const targetCollectionName = `persona-${targetPersonaId}`;
    let migratedCount = 0;

    try {
      // Ensure target collection exists
      const targetExists = await this.checkCollectionExists(targetCollectionName);
      if (!targetExists) {
        // Get vector size from legacy collection
        const legacyCollection = await this.qdrant.getCollection(legacyCollectionName);
        const vectorSize = legacyCollection.config?.params?.vectors?.size || 1536;

        // Create target collection with same config
        await this.qdrant.createCollection(targetCollectionName, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        });

        // Create payload indexes
        await this.qdrant.createPayloadIndex(targetCollectionName, {
          field_name: 'personalityId',
          field_schema: 'keyword',
        });

        await this.qdrant.createPayloadIndex(targetCollectionName, {
          field_name: 'createdAt',
          field_schema: 'integer',
        });

        console.log(`  ✅ Created target collection: ${targetCollectionName}`);
      }

      // Scroll through all points in legacy collection
      let offset: string | number | null = null;
      let hasMore = true;

      while (hasMore) {
        const scrollResult = await this.qdrant.scroll(legacyCollectionName, {
          limit: 100,
          offset,
          with_payload: true,
          with_vector: true,
        });

        if (!scrollResult.points || scrollResult.points.length === 0) {
          break;
        }

        // Copy points to target collection
        for (const point of scrollResult.points) {
          try {
            // Update metadata: canonScope 'legacy' → 'personal', personaId → target
            const updatedPayload = {
              ...point.payload,
              personaId: targetPersonaId,
              canonScope: 'personal',
            };

            await this.qdrant.upsert(targetCollectionName, {
              points: [
                {
                  id: point.id,
                  vector: point.vector as number[],
                  payload: updatedPayload,
                },
              ],
            });

            migratedCount++;

            if (migratedCount % 10 === 0) {
              console.log(`  📦 Migrated ${migratedCount} memories...`);
            }
          } catch (error) {
            errors.push({
              memoryId: String(point.id),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Update offset for next batch
        offset = scrollResult.next_page_offset;
        hasMore = offset !== null && offset !== undefined;
      }

      return migratedCount;
    } catch (error) {
      console.error('Failed to migrate memories:', error);
      throw error;
    }
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  // Parse args
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: pnpm migrate-legacy-persona <shapesUserId> <discordId> [options]
       pnpm migrate-legacy-persona <shapesUserId> --user-id <v3UserId> [options]

Arguments:
  shapesUserId         Shapes.inc user UUID (from legacy persona collection name)
  discordId            Discord ID of v3 user (default identification method)

Options:
  --user-id <id>       Use v3 user ID instead of Discord ID
  --dry-run            Preview migration without making changes
  --keep-legacy        Keep legacy collection after migration (don't delete)

Examples:
  pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 278863839632818186
  pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 278863839632818186 --dry-run
  pnpm migrate-legacy-persona 98a94b95-cbd0-430b-8be2-602e1c75d8b0 --user-id e64fcc09-e4db-5902-b1c9-5750141e3bf2
    `);
    process.exit(0);
  }

  const shapesUserId = args[0];
  const userIdIndex = args.indexOf('--user-id');
  const discordId = userIdIndex === -1 ? args[1] : undefined;
  const v3UserId = userIdIndex !== -1 ? args[userIdIndex + 1] : undefined;

  if (!shapesUserId) {
    console.error('Error: shapesUserId is required');
    process.exit(1);
  }

  if (!discordId && !v3UserId) {
    console.error('Error: Either Discord ID or --user-id must be provided');
    process.exit(1);
  }

  const options: MigrationOptions = {
    shapesUserId,
    discordId,
    v3UserId,
    dryRun: args.includes('--dry-run'),
    keepLegacy: args.includes('--keep-legacy'),
  };

  const migration = new LegacyPersonaMigration();
  await migration.migrate(options);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
