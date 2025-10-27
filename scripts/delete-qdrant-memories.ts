/**
 * Delete specific Qdrant memories by time range and persona
 *
 * Usage:
 * npx tsx scripts/delete-qdrant-memories.ts \
 *   --personality-id <uuid> \
 *   --persona-id <uuid> \
 *   --start-time <ISO timestamp> \
 *   --end-time <ISO timestamp> \
 *   [--dry-run]
 */

import { QdrantClient } from '@qdrant/js-client-rest';

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

interface DeleteOptions {
  personalityId: string;
  personaId: string;
  startTime: string;
  endTime: string;
  dryRun: boolean;
}

async function deleteMemories(options: DeleteOptions) {
  const { personalityId, personaId, startTime, endTime, dryRun } = options;

  // Connect to Qdrant
  const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });

  const collectionName = `persona-${personaId}`;

  logger.info(`Searching for memories in collection: ${collectionName}`);
  logger.info(`Personality: ${personalityId}`);
  logger.info(`Time range: ${startTime} to ${endTime}`);

  // Convert timestamps to Unix timestamps (milliseconds)
  const startTimestamp = new Date(startTime).getTime();
  const endTimestamp = new Date(endTime).getTime();

  logger.info(`Unix timestamps (ms): ${startTimestamp} to ${endTimestamp}`);

  try {
    // Search for points matching criteria
    const scrollResult = await qdrant.scroll(collectionName, {
      filter: {
        must: [
          {
            key: 'personalityId',
            match: { value: personalityId }
          },
          {
            key: 'createdAt',
            range: {
              gte: startTimestamp,
              lte: endTimestamp
            }
          }
        ]
      },
      limit: 100,
      with_payload: true,
      with_vector: false
    });

    const points = scrollResult.points;

    if (points.length === 0) {
      logger.info('No memories found matching criteria');
      return;
    }

    logger.info(`Found ${points.length} memories to delete:`);

    // Display what we found
    for (const point of points) {
      const payload = point.payload as any;
      logger.info(`\n  ID: ${point.id}`);
      logger.info(`  Timestamp: ${new Date(payload.createdAt).toISOString()}`);
      logger.info(`  Personality: ${payload.personalityId}`);
      logger.info(`  Content (first 200 chars): ${payload.content?.substring(0, 200)}...`);
    }

    if (dryRun) {
      logger.info('\n[DRY RUN] Would delete these memories. Run without --dry-run to actually delete.');
      return;
    }

    // Delete the points
    const pointIds = points.map(p => p.id);

    logger.info(`\nDeleting ${pointIds.length} memories...`);

    await qdrant.delete(collectionName, {
      points: pointIds
    });

    logger.info('✅ Memories deleted successfully');

  } catch (error) {
    logger.error({ err: error }, 'Failed to delete memories');
    throw error;
  }
}

// Parse command line arguments
function parseArgs(): DeleteOptions {
  const args = process.argv.slice(2);

  const getArg = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index !== -1 ? args[index + 1] : undefined;
  };

  const personalityId = getArg('--personality-id');
  const personaId = getArg('--persona-id');
  const startTime = getArg('--start-time');
  const endTime = getArg('--end-time');
  const dryRun = args.includes('--dry-run');

  if (!personalityId || !personaId || !startTime || !endTime) {
    console.error(`
Usage:
  npx tsx scripts/delete-qdrant-memories.ts \\
    --personality-id <uuid> \\
    --persona-id <uuid> \\
    --start-time <ISO timestamp> \\
    --end-time <ISO timestamp> \\
    [--dry-run]

Example:
  npx tsx scripts/delete-qdrant-memories.ts \\
    --personality-id c296b337-4e67-5337-99a3-4ca105cbbd68 \\
    --persona-id 782be8b4-9fd9-5005-9358-5605f63ead99 \\
    --start-time "2025-10-27T05:04:00Z" \\
    --end-time "2025-10-27T05:12:00Z" \\
    --dry-run
    `);
    process.exit(1);
  }

  return {
    personalityId,
    personaId,
    startTime,
    endTime,
    dryRun
  };
}

async function main() {
  const options = parseArgs();
  await deleteMemories(options);
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
