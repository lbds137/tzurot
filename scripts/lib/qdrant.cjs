/**
 * Qdrant Vector Database Client
 *
 * Handles connections to Qdrant Cloud for storing and retrieving
 * personality long-term memories (LTM).
 */

const { QdrantClient } = require('@qdrant/js-client-rest');

/**
 * Creates a Qdrant client instance
 * @returns {QdrantClient}
 */
function createQdrantClient() {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url || !apiKey) {
    throw new Error('QDRANT_URL and QDRANT_API_KEY must be set in environment');
  }

  return new QdrantClient({
    url,
    apiKey,
  });
}

/**
 * Ensures a collection exists in Qdrant with the proper schema
 * @param {QdrantClient} client
 * @param {string} collectionName
 * @param {number} vectorSize - Embedding dimension (1536 for OpenAI text-embedding-3-small)
 */
async function ensureCollection(client, collectionName, vectorSize = 1536) {
  try {
    // Check if collection exists
    await client.getCollection(collectionName);
    console.log(`✓ Collection "${collectionName}" already exists`);
  } catch (error) {
    if (error.status === 404) {
      // Create collection
      console.log(`Creating collection "${collectionName}"...`);
      await client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine', // Best for semantic similarity
        },
        optimizers_config: {
          default_segment_number: 2,
        },
        replication_factor: 1,
      });
      console.log(`✓ Created collection "${collectionName}"`);
    } else {
      throw error;
    }
  }
}

/**
 * Stores memories in Qdrant
 * @param {QdrantClient} client
 * @param {string} collectionName
 * @param {Array<{id: string, vector: number[], payload: object}>} memories
 */
async function upsertMemories(client, collectionName, memories) {
  if (memories.length === 0) {
    console.log('No memories to upsert');
    return;
  }

  const points = memories.map(memory => ({
    id: memory.id,
    vector: memory.vector,
    payload: memory.payload,
  }));

  await client.upsert(collectionName, {
    wait: true,
    points,
  });

  console.log(`✓ Upserted ${memories.length} memories to "${collectionName}"`);
}

/**
 * Searches for similar memories
 * @param {QdrantClient} client
 * @param {string} collectionName
 * @param {number[]} queryVector
 * @param {number} limit
 * @param {object} filter - Optional Qdrant filter
 */
async function searchMemories(client, collectionName, queryVector, limit = 10, filter = null) {
  const result = await client.search(collectionName, {
    vector: queryVector,
    limit,
    filter,
    with_payload: true,
  });

  return result;
}

module.exports = {
  createQdrantClient,
  ensureCollection,
  upsertMemories,
  searchMemories,
};
