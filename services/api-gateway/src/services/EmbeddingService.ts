/**
 * Embedding Service
 *
 * Generates embeddings using OpenAI's text-embedding-3-small model.
 * Used for memory search functionality.
 */

import { OpenAI } from 'openai';
import { createLogger, getConfig, MODEL_DEFAULTS } from '@tzurot/common-types';

const logger = createLogger('embedding-service');
const config = getConfig();

/** Expected embedding dimension for text-embedding-3-small */
const EMBEDDING_DIMENSION = 1536;

/** Singleton OpenAI client instance */
let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client
 * Returns null if OPENAI_API_KEY is not configured
 */
function getOpenAIClient(): OpenAI | null {
  if (openaiClient !== null) {
    return openaiClient;
  }

  const apiKey = config.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    logger.warn({}, '[EmbeddingService] OPENAI_API_KEY not configured - embedding search disabled');
    return null;
  }

  openaiClient = new OpenAI({ apiKey });
  logger.info('[EmbeddingService] OpenAI client initialized for embeddings');
  return openaiClient;
}

/**
 * Check if embedding service is available
 */
export function isEmbeddingServiceAvailable(): boolean {
  return getOpenAIClient() !== null;
}

/**
 * Generate an embedding vector for the given text
 *
 * @param text - The text to generate an embedding for
 * @returns The embedding vector (1536 dimensions) or null if service unavailable
 * @throws Error if API call fails
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const client = getOpenAIClient();
  if (client === null) {
    return null;
  }

  if (text.trim().length === 0) {
    logger.warn({}, '[EmbeddingService] Empty text provided for embedding');
    return null;
  }

  const model = config.EMBEDDING_MODEL ?? MODEL_DEFAULTS.EMBEDDING;

  logger.debug({ textLength: text.length, model }, '[EmbeddingService] Generating embedding');

  const response = await client.embeddings.create({
    model,
    input: text,
  });

  if (response.data.length === 0) {
    throw new Error('OpenAI embeddings API returned empty data array');
  }

  const embedding = response.data[0].embedding;

  if (embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Invalid embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${embedding.length}`
    );
  }

  logger.debug({ dimension: embedding.length }, '[EmbeddingService] Embedding generated');

  return embedding;
}

/**
 * Format embedding array as PostgreSQL vector string
 */
export function formatAsVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
