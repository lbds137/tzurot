/**
 * Embedding Service
 *
 * Generates embeddings using local BGE-small-en-v1.5 model (384 dimensions).
 * Runs in a Worker Thread to avoid blocking the event loop.
 *
 * Previously used OpenAI's text-embedding-3-small (1536 dimensions).
 * Migration: OpenAI embeddings → Local BGE embeddings
 */

import { createLogger } from '@tzurot/common-types';
import { LocalEmbeddingService, LOCAL_EMBEDDING_DIMENSIONS } from '@tzurot/embeddings';

const logger = createLogger('embedding-service');

/** Expected embedding dimension for BGE-small-en-v1.5 */
export const EMBEDDING_DIMENSION = LOCAL_EMBEDDING_DIMENSIONS;

/** Singleton embedding service instance */
let embeddingService: LocalEmbeddingService | null = null;
let initializationPromise: Promise<boolean> | null = null;

/**
 * Initialize the embedding service
 * Should be called during service startup
 * @returns true if initialization succeeded, false otherwise
 */
export async function initializeEmbeddingService(): Promise<boolean> {
  if (embeddingService?.isServiceReady() === true) {
    return true;
  }

  // Prevent multiple concurrent initialization attempts
  if (initializationPromise !== null) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      logger.info('[EmbeddingService] Initializing local embedding service...');
      embeddingService = new LocalEmbeddingService();
      const success = await embeddingService.initialize();

      if (success) {
        logger.info('[EmbeddingService] Local embedding service initialized successfully');
      } else {
        logger.warn({}, '[EmbeddingService] Local embedding service failed to initialize');
        embeddingService = null;
      }

      return success;
    } catch (error) {
      logger.error({ err: error }, '[EmbeddingService] Failed to initialize embedding service');
      embeddingService = null;
      return false;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Check if embedding service is available
 */
export function isEmbeddingServiceAvailable(): boolean {
  return embeddingService?.isServiceReady() === true;
}

/**
 * Generate an embedding vector for the given text
 *
 * @param text - The text to generate an embedding for
 * @returns The embedding vector (384 dimensions) or null if service unavailable
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (embeddingService === null || embeddingService.isServiceReady() === false) {
    logger.warn({}, '[EmbeddingService] Service not ready - call initializeEmbeddingService first');
    return null;
  }

  if (text.trim().length === 0) {
    logger.warn({}, '[EmbeddingService] Empty text provided for embedding');
    return null;
  }

  logger.debug({ textLength: text.length }, '[EmbeddingService] Generating embedding');

  const embedding = await embeddingService.getEmbedding(text);

  if (embedding === undefined) {
    logger.warn({}, '[EmbeddingService] Failed to generate embedding');
    return null;
  }

  if (embedding.length !== EMBEDDING_DIMENSION) {
    logger.error(
      { expected: EMBEDDING_DIMENSION, got: embedding.length },
      '[EmbeddingService] Invalid embedding dimension'
    );
    return null;
  }

  logger.debug({ dimension: embedding.length }, '[EmbeddingService] Embedding generated');

  // Convert Float32Array to number[] for API compatibility
  return Array.from(embedding);
}

/**
 * Format embedding array as PostgreSQL vector string
 * Validates all elements are finite numbers to prevent SQL injection
 * @throws Error if any element is not a valid finite number
 */
export function formatAsVector(embedding: number[]): string {
  for (const value of embedding) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('Invalid embedding: all elements must be finite numbers');
    }
  }
  return `[${embedding.join(',')}]`;
}

/**
 * Shutdown the embedding service gracefully
 * Should be called during service shutdown
 */
export async function shutdownEmbeddingService(): Promise<void> {
  if (embeddingService !== null) {
    logger.info('[EmbeddingService] Shutting down embedding service...');
    await embeddingService.shutdown();
    embeddingService = null;
    logger.info('[EmbeddingService] Embedding service shut down');
  }
}

/**
 * Reset internal state for testing purposes
 * @internal Only use in tests
 */
export function __resetForTesting(): void {
  embeddingService = null;
  initializationPromise = null;
}
