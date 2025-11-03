/**
 * Migrate existing Qdrant collections to use disk storage for vectors and HNSW index
 *
 * This updates both:
 * 1. vectors.on_disk=true - Moves raw vectors from RAM to disk
 * 2. hnsw_config.on_disk=true - Moves HNSW index from RAM to disk
 *
 * This prevents memory exhaustion by storing all collection data on disk.
 * The migration will trigger background optimization which may take time.
 */

import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

if (!QDRANT_URL || !QDRANT_API_KEY) {
  console.error('❌ Missing QDRANT_URL or QDRANT_API_KEY environment variables');
  process.exit(1);
}

async function migrateCollectionsToDisk() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL!,
    apiKey: QDRANT_API_KEY!,
  });

  console.log('🔄 Migrating Qdrant collections to disk storage...\n');

  try {
    // Get all collections
    const response = await qdrant.getCollections();
    const collections = response.collections;

    console.log(`Found ${collections.length} collections\n`);

    for (const collection of collections) {
      const collectionName = collection.name;
      console.log(`Updating ${collectionName}...`);

      try {
        // Update both vectors and HNSW index to use disk storage
        // Using empty string "" for vector name (collections without named vectors)
        await qdrant.updateCollection(collectionName, {
          vectors: {
            '': {
              on_disk: true,
            },
          },
          hnsw_config: {
            on_disk: true,
          },
        });

        console.log(`  ✅ Migrated vectors and HNSW index to disk\n`);
      } catch (error) {
        console.error(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }

    console.log('✅ Migration complete!');
  } catch (error) {
    console.error('❌ Failed to list collections:', error);
    process.exit(1);
  }
}

migrateCollectionsToDisk();
