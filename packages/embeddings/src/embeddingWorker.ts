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
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { MODEL_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { LOCAL_EMBEDDING_DIMENSIONS } from './constants.js';
import type { ModelSource, WorkerMessage, WorkerResponse } from './types.js';

/**
 * Point transformers.js at the vendored in-repo model when present, falling
 * back to remote download when absent. The model is vendored
 * (`packages/embeddings/models/`) because anonymous HuggingFace downloads are
 * unreliable from datacenter IPs (CI runners, Railway builders/boot) — an HF
 * access change turned the fetch into a platform-wide 403, breaking CI and
 * making every service (re)boot a gamble. The local copy removes the runtime
 * network dependency entirely; remote stays as the fallback so a stripped
 * environment degrades to the old behavior instead of failing outright.
 *
 * Exported for unit tests; invoked once at module load with the real `env`.
 */
export function configureTransformersEnv(
  transformersEnv: { allowLocalModels: boolean; useBrowserCache: boolean; localModelPath?: string },
  modelsDir: string,
  modelId: string,
  pathExists: (path: string) => boolean = existsSync
): ModelSource {
  transformersEnv.useBrowserCache = false; // We're in Node.js, not browser
  if (pathExists(join(modelsDir, modelId))) {
    transformersEnv.allowLocalModels = true;
    transformersEnv.localModelPath = modelsDir;
    return 'local';
  }
  transformersEnv.allowLocalModels = false;
  return 'remote';
}

// `../models` resolves to the package root from BOTH src/ (tsx, vitest) and
// dist/ (production builds) — the two layouts share the same depth.
const modelSource = configureTransformersEnv(
  env,
  join(dirname(fileURLToPath(import.meta.url)), '..', 'models'),
  MODEL_DEFAULTS.EMBEDDING
);

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
    extractor = await pipeline('feature-extraction', MODEL_DEFAULTS.EMBEDDING, {
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
 * Count the input in the model's own tokens, BEFORE truncation.
 *
 * Calling the tokenizer bare (no `truncation` option) is what makes this the
 * pre-truncation length: the pipeline passes `truncation: true` internally and
 * so can only ever report the clamped value. Verified against the vendored
 * model — a deliberately over-long input returns dims `[1, 602]` here while the
 * pipeline embeds 512 of them.
 *
 * Returns `undefined` rather than throwing on any unexpected shape. This number
 * exists to make a silent problem visible; it must never become a way for
 * embedding itself to fail, so every access is guarded and a surprise degrades
 * to "unknown" instead of taking the call down with it.
 *
 * ## Cost of the second tokenization, measured
 *
 * This does tokenize the input twice — once here, once inside the pipeline's
 * own truncated call — on EVERY embed, not only overflowing ones. Benchmarked
 * against the vendored q8 model rather than assumed:
 *
 * | input            | tokenize | full embed | overhead |
 * | ---------------- | -------- | ---------- | -------- |
 * | short (~10 tok)  | 0.114 ms | 6.90 ms    | 1.65%    |
 * | long (>512 tok)  | 1.565 ms | 171.80 ms  | 0.91%    |
 *
 * The share FALLS as input grows, because the transformer forward pass scales
 * worse than a linear tokenizer scan — so the longer-content call sites
 * (FactStore, PgvectorMemoryAdapter) are the ones where it matters least. No
 * reason to optimise this away; re-measure only if the model or dtype changes.
 */
function countInputTokens(embeddingPipeline: unknown, text: string): number | undefined {
  try {
    const tokenizer = (embeddingPipeline as { tokenizer?: (input: string) => unknown }).tokenizer;
    if (typeof tokenizer !== 'function') {
      return undefined;
    }
    const encoded = tokenizer(text) as { input_ids?: { dims?: number[]; size?: number } };
    const dims = encoded.input_ids?.dims;
    // Shape is [batch, sequence]; the sequence length is the last dimension.
    const sequenceLength = Array.isArray(dims) ? dims[dims.length - 1] : undefined;
    if (typeof sequenceLength === 'number') {
      return sequenceLength;
    }
    return typeof encoded.input_ids?.size === 'number' ? encoded.input_ids.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Generate embedding for text
 * Returns normalized vector suitable for cosine similarity
 */
async function generateEmbedding(text: string): Promise<{
  vector: number[];
  inputTokens: number | undefined;
}> {
  const embeddingPipeline = await getExtractor();

  // Count with the model's OWN tokenizer before the pipeline runs. The pipeline
  // tokenizes again internally with `truncation: true` and keeps no record of
  // what it dropped, so this is the only place the pre-truncation length can be
  // observed. It is the same tokenizer instance, so the count is exact rather
  // than an estimate — and cheap next to the forward pass.
  const inputTokens = countInputTokens(embeddingPipeline, text);

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

  return { vector, inputTokens };
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

        const { vector, inputTokens } = await generateEmbedding(message.text);
        response.status = 'success';
        response.vector = vector;
        response.inputTokens = inputTokens;
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

  // Signal that worker is ready to receive messages. `modelSource` tells the
  // main thread (and its logs) whether the vendored model or a remote
  // download will serve this process — the load itself is lazy.
  parentPort.postMessage({ id: 0, status: 'ready', modelSource });
}
