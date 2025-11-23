#!/usr/bin/env tsx

/**
 * Migration Script: Update Qdrant memories to use persona names instead of "User (username)"
 *
 * This script:
 * 1. Connects to Qdrant and PostgreSQL
 * 2. Scrolls through all memories across all collections
 * 3. Identifies memories with "User (...)" format
 * 4. Looks up the persona name from personaId in metadata
 * 5. Updates the memory text to use persona name
 * 6. Re-embeds and updates in Qdrant
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings } from '@langchain/openai';
import { getPrismaClient } from '../../packages/common-types/src/services/prisma.ts';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

interface MemoryPoint {
  id: string | number;
  payload: {
    content: string;
    personaId?: string;
    personalityId?: string;
    personalityName?: string;
    [key: string]: any;
  };
  vector?: number[];
}

async function main() {
  // Check for dry-run mode
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    logger.info('🔍 DRY RUN MODE - No changes will be made to Qdrant');
  }

  // Validate required environment variables
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!qdrantUrl || !qdrantApiKey) {
    logger.error('Missing required environment variables: QDRANT_URL, QDRANT_API_KEY');
    process.exit(1);
  }

  if (!openaiApiKey && !dryRun) {
    logger.error('Missing OPENAI_API_KEY - needed for re-embedding updated memories');
    logger.info('Tip: Use --dry-run to preview changes without needing OPENAI_API_KEY');
    process.exit(1);
  }

  logger.info('Starting memory format migration...');
  logger.info(`Connecting to Qdrant at ${qdrantUrl}`);

  // Initialize clients
  const qdrant = new QdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey,
  });

  // Only initialize embeddings if not dry-run (we'll need it for re-embedding)
  const embeddings = !dryRun
    ? new OpenAIEmbeddings({
        openAIApiKey: openaiApiKey!,
        modelName: 'text-embedding-3-small',
      })
    : null;

  const prisma = getPrismaClient();

  try {
    // Get all collections
    const collections = await qdrant.getCollections();
    logger.info(`Found ${collections.collections.length} collections`);

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    // Process each collection
    for (const collection of collections.collections) {
      const collectionName = collection.name;
      logger.info(`\nProcessing collection: ${collectionName}`);

      // Scroll through all points in this collection
      let offset: string | number | null | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const scrollResult = await qdrant.scroll(collectionName, {
          limit: 100,
          offset,
          with_payload: true,
          with_vector: false, // We'll generate new vectors
        });

        const points = scrollResult.points as MemoryPoint[];

        if (points.length === 0) {
          hasMore = false;
          break;
        }

        logger.info(`Fetched ${points.length} points (offset: ${offset || 'start'})`);

        // Process each point
        for (const point of points) {
          totalProcessed++;

          const content = point.payload?.content;
          if (!content || typeof content !== 'string') {
            continue;
          }

          // Check if this memory uses the old "User (...)" format
          const userPattern = /^User \([^)]+\):/;
          if (!userPattern.test(content)) {
            // Skip - doesn't need migration (might be shapes.inc format or already migrated)
            continue;
          }

          logger.info(`\nFound memory needing migration (ID: ${point.id})`);
          logger.debug(`Original content: ${content.substring(0, 100)}...`);

          try {
            // Extract personaId from metadata
            const personaId = point.payload.personaId;
            if (!personaId) {
              logger.warn(`  ⚠️  No personaId in metadata, skipping`);
              totalErrors++;
              continue;
            }

            // Look up persona name from database
            const persona = await prisma.persona.findUnique({
              where: { id: personaId },
              select: {
                preferredName: true,
                name: true,
              },
            });

            if (!persona) {
              logger.warn(`  ⚠️  Persona ${personaId} not found in database, skipping`);
              totalErrors++;
              continue;
            }

            const personaName = persona.preferredName || persona.name;

            // Replace "User (username):" with persona name
            const updatedContent = content.replace(userPattern, `${personaName}:`);

            if (updatedContent === content) {
              logger.warn(`  ⚠️  Pattern replacement failed, skipping`);
              totalErrors++;
              continue;
            }

            logger.info(`  ✓ Would update to use persona name: ${personaName}`);
            logger.debug(`  Updated content: ${updatedContent.substring(0, 100)}...`);

            if (!dryRun && embeddings) {
              // Generate new embedding for updated content
              const [newVector] = await embeddings.embedDocuments([updatedContent]);

              // Update the point in Qdrant
              await qdrant.upsert(collectionName, {
                wait: true,
                points: [
                  {
                    id: point.id,
                    vector: newVector,
                    payload: {
                      ...point.payload,
                      content: updatedContent,
                    },
                  },
                ],
              });

              logger.info(`  ✓ Successfully updated memory ${point.id}`);
            } else {
              logger.info(`  ✓ [DRY RUN] Would update memory ${point.id}`);
            }
            totalUpdated++;
          } catch (error) {
            logger.error({ err: error }, `  ✗ Error updating memory ${point.id}`);
            totalErrors++;
          }
        }

        // Update offset for next page
        offset = scrollResult.next_page_offset;
        if (!offset) {
          hasMore = false;
        }
      }

      logger.info(`Finished collection ${collectionName}`);
    }

    logger.info('\n=== Migration Complete ===');
    if (dryRun) {
      logger.info('🔍 DRY RUN - No actual changes were made');
    }
    logger.info(`Total memories processed: ${totalProcessed}`);
    logger.info(`Total memories ${dryRun ? 'that would be' : ''} updated: ${totalUpdated}`);
    logger.info(`Total errors: ${totalErrors}`);

    if (dryRun && totalUpdated > 0) {
      logger.info('\n💡 To apply these changes, run: pnpm migrate-memory-format');
    }
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
