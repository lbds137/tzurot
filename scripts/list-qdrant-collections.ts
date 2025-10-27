/**
 * List all Qdrant collections
 */

import { QdrantClient } from '@qdrant/js-client-rest';

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

async function listCollections() {
  const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });

  try {
    const result = await qdrant.getCollections();

    logger.info(`Found ${result.collections.length} collections:`);

    for (const collection of result.collections) {
      logger.info(`\n  Collection: ${collection.name}`);

      // Get collection info
      const info = await qdrant.getCollection(collection.name);
      logger.info(`    Points: ${info.points_count}`);
      logger.info(`    Vectors: ${info.vectors_count}`);
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to list collections');
    throw error;
  }
}

listCollections().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
