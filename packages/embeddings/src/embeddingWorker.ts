/**
 * Embedding Worker - Runs in separate thread to avoid blocking event loop
 *
 * Uses @huggingface/transformers to generate embeddings locally with
 * the bge-small-en-v1.5 model (384 dimensions, ~30MB quantized).
 *
 * CRITICAL: Embedding generation is CPU-intensive. Running it on the main
 * thread would block the Node.js event loop, causing Discord heartbeat
 * failures and missed messages. Worker threads solve this by running
 * the computation in a separate V8 isolate.
 */

import { parentPort } from 'node:worker_threads';
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

import { LOCAL_EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_NAME } from './constants.js';
import type { WorkerMessage, WorkerResponse } from './types.js';

// Configure transformers.js for server-side use
env.allowLocalModels = false; // Download from HuggingFace Hub
env.useBrowserCache = false; // We're in Node.js, not browser

// ============================================================================
// SINGLETON PIPELINE
// ============================================================================

let extractor: FeatureExtractionPipeline | null = null;
let modelLoading = false;
let modelLoadError: string | null = null;

/**
 * Get or initialize the embedding pipeline
 * Uses singleton pattern - model loads once on first use
 */
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor !== null) {
    return extractor;
  }

  // Sticky failure: once the model fails to load, all future calls throw immediately.
  // Recovery requires the main thread to restart the worker (creates a fresh V8 isolate).
  if (modelLoadError !== null) {
    throw new Error(`Model previously failed to load: ${modelLoadError}`);
  }

  if (modelLoading) {
    // Wait for in-progress load
    while (modelLoading && extractor === null && modelLoadError === null) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (extractor !== null) {
      return extractor;
    }
    throw new Error(`Model failed to load: ${modelLoadError ?? 'Unknown error'}`);
  }

  modelLoading = true;

  try {
    // Load the model with quantization for faster inference
    // bge-small-en-v1.5 is optimized for retrieval/semantic similarity
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_NAME, {
      dtype: 'q8', // 8-bit quantization for ~4x smaller model
    });

    return extractor;
  } catch (error) {
    modelLoadError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    modelLoading = false;
  }
}

/**
 * Generate embedding for text
 * Returns normalized vector suitable for cosine similarity
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const embeddingPipeline = await getExtractor();

  // Generate embedding with mean pooling and normalization
  // pooling: 'mean' averages all token embeddings
  // normalize: true L2-normalizes the output (required for cosine similarity)
  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Convert to regular array
  // output.data is a Float32Array of shape [1, 384]
  const vector = Array.from(output.data as Float32Array);

  // Validate dimensions
  if (vector.length !== LOCAL_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding dimensions: expected ${LOCAL_EMBEDDING_DIMENSIONS}, got ${vector.length}`
    );
  }

  return vector;
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

/**
 * Handle incoming messages from the main thread
 */
async function handleMessage(message: WorkerMessage): Promise<void> {
  const response: WorkerResponse = { id: message.id, status: 'error' };

  try {
    switch (message.type) {
      case 'embed': {
        if (message.text === undefined || message.text === '') {
          response.error = 'No text provided for embedding';
          break;
        }

        const vector = await generateEmbedding(message.text);
        response.status = 'success';
        response.vector = vector;
        break;
      }

      case 'health': {
        // Try to load model if not already loaded
        try {
          await getExtractor();
          response.status = 'success';
          response.modelLoaded = true;
        } catch {
          response.status = 'success';
          response.modelLoaded = false;
          response.error = modelLoadError ?? 'Model not loaded';
        }
        break;
      }

      default: {
        response.error = `Unknown message type: ${(message as { type: string }).type}`;
      }
    }
  } catch (error) {
    response.status = 'error';
    response.error = error instanceof Error ? error.message : String(error);
  }

  parentPort?.postMessage(response);
}

if (parentPort !== null) {
  parentPort.on('message', (message: WorkerMessage) => {
    void handleMessage(message);
  });

  // Signal that worker is ready to receive messages
  parentPort.postMessage({ id: 0, status: 'ready' });
}
