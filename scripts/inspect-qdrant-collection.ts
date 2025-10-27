/**
 * Inspect Qdrant collection schema
 */

import { QdrantClient } from '@qdrant/js-client-rest';

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

async function inspectCollection(collectionName: string) {
  const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });

  try {
    // Get a few sample points
    const result = await qdrant.scroll(collectionName, {
      limit: 3,
      with_payload: true,
      with_vector: false
    });

    logger.info(`Sample points from ${collectionName}:`);

    for (const point of result.points) {
      logger.info('\n================');
      logger.info('Point ID:', point.id);
      logger.info('Payload:', JSON.stringify(point.payload, null, 2));
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to inspect collection');
    throw error;
  }
}

const collectionName = process.argv[2];
if (!collectionName) {
  console.error('Usage: npx tsx scripts/inspect-qdrant-collection.ts <collection-name>');
  process.exit(1);
}

inspectCollection(collectionName).catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
