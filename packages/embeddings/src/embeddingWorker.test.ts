/**
 * Tests for Embedding Worker
 *
 * Tests the worker's message handling logic: embed, health, and unknown types.
 * The HuggingFace pipeline is mocked — actual model loading is too slow for unit tests.
 *
 * NOTE: These tests use real timers (no vi.useFakeTimers()) because the worker's
 * getExtractor() has a busy-wait polling loop with real setTimeout(100ms). Fake
 * timers can't advance time inside the worker's async flow without deadlocking.
 * We use vi.waitFor() instead, which works with real timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkerResponse } from './types.js';

// Capture messages posted back from the worker
const postedMessages: WorkerResponse[] = [];
const messageHandlers: ((msg: unknown) => void)[] = [];

// Mock parentPort before the worker module is imported
vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: vi.fn((event: string, handler: (msg: unknown) => void) => {
      if (event === 'message') {
        messageHandlers.push(handler);
      }
    }),
    postMessage: vi.fn((msg: WorkerResponse) => {
      postedMessages.push(msg);
    }),
  },
}));

// Mock common-types to provide MODEL_DEFAULTS.EMBEDDING
vi.mock('@tzurot/common-types/constants/ai', () => ({
  MODEL_DEFAULTS: { EMBEDDING: 'Xenova/bge-small-en-v1.5' },
}));
// Mock the HuggingFace pipeline
const mockPipeline = vi.fn();
vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
  env: { allowLocalModels: true, useBrowserCache: true },
}));

describe('embeddingWorker', () => {
  beforeEach(async () => {
    postedMessages.length = 0;
    messageHandlers.length = 0;
    vi.resetModules();
    mockPipeline.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadWorker(): Promise<void> {
    await import('./embeddingWorker.js');
  }

  function getMessageHandler(): (msg: unknown) => void {
    // Returns the handler registered via parentPort.on('message', handler)
    const handler = messageHandlers[messageHandlers.length - 1];
    if (handler === undefined) {
      throw new Error('No message handler registered');
    }
    return handler;
  }

  it('should send ready signal on startup, carrying the model source', async () => {
    await loadWorker();

    // The repo checkout vendors the model, so a real-existsSync load reports 'local'.
    expect(postedMessages).toContainEqual({ id: 0, status: 'ready', modelSource: 'local' });
  });

  it('should register a message handler on parentPort', async () => {
    await loadWorker();

    expect(messageHandlers.length).toBeGreaterThan(0);
  });

  describe('embed message', () => {
    it('should return embedding vector on success', async () => {
      const fakeVector = new Float32Array(384).fill(0.1);
      const mockExtractor = vi.fn().mockResolvedValue({ data: fakeVector });
      mockPipeline.mockResolvedValue(mockExtractor);

      await loadWorker();
      const handler = getMessageHandler();

      // Reset posted messages to ignore ready signal
      postedMessages.length = 0;

      // Send health first to load the model
      await handler({ type: 'health', id: 1 });
      // Wait for async handler
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      postedMessages.length = 0;
      await handler({ type: 'embed', text: 'Hello world', id: 2 });
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      expect(postedMessages[0].status).toBe('success');
      expect(postedMessages[0].id).toBe(2);
      expect(postedMessages[0].vector).toHaveLength(384);
    });

    it('should return error when no text provided', async () => {
      await loadWorker();
      const handler = getMessageHandler();

      postedMessages.length = 0;
      await handler({ type: 'embed', id: 3 });
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      expect(postedMessages[0]).toMatchObject({
        id: 3,
        status: 'error',
        error: 'No text provided for embedding',
      });
    });

    it('should return error when text is empty string', async () => {
      await loadWorker();
      const handler = getMessageHandler();

      postedMessages.length = 0;
      await handler({ type: 'embed', text: '', id: 4 });
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      expect(postedMessages[0]).toMatchObject({
        id: 4,
        status: 'error',
        error: 'No text provided for embedding',
      });
    });
  });

  describe('health message', () => {
    it('should report model loaded on success', async () => {
      const mockExtractor = vi.fn();
      mockPipeline.mockResolvedValue(mockExtractor);

      await loadWorker();
      const handler = getMessageHandler();

      postedMessages.length = 0;
      await handler({ type: 'health', id: 5 });
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      expect(postedMessages[0]).toMatchObject({
        id: 5,
        status: 'success',
        modelLoaded: true,
      });
    });

    it('should report model not loaded on pipeline failure', async () => {
      mockPipeline.mockRejectedValue(new Error('Model download failed'));

      await loadWorker();
      const handler = getMessageHandler();

      postedMessages.length = 0;
      await handler({ type: 'health', id: 6 });
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      expect(postedMessages[0]).toMatchObject({
        id: 6,
        status: 'success',
        modelLoaded: false,
        error: 'Model download failed',
      });
    });
  });

  describe('unknown message type', () => {
    it('should return error for unknown message type', async () => {
      await loadWorker();
      const handler = getMessageHandler();

      postedMessages.length = 0;
      await handler({ type: 'unknown-type', id: 7 });
      await vi.waitFor(() => expect(postedMessages.length).toBe(1));

      expect(postedMessages[0]).toMatchObject({
        id: 7,
        status: 'error',
        error: expect.stringContaining('Unknown message type'),
      });
    });
  });

  describe('configureTransformersEnv', () => {
    async function loadConfigureFn(): Promise<
      typeof import('./embeddingWorker.js').configureTransformersEnv
    > {
      return (await import('./embeddingWorker.js')).configureTransformersEnv;
    }

    it('prefers the vendored model dir when it exists', async () => {
      const configureTransformersEnv = await loadConfigureFn();
      const fakeEnv = { allowLocalModels: false, useBrowserCache: true };
      const checked: string[] = [];

      const source = configureTransformersEnv(fakeEnv, '/models', 'Org/model-x', path => {
        checked.push(path);
        return true;
      });

      expect(source).toBe('local');
      expect(fakeEnv).toMatchObject({
        allowLocalModels: true,
        useBrowserCache: false,
        localModelPath: '/models',
      });
      // It must probe the model-id SUBDIRECTORY, not just the models root —
      // an empty models/ dir must not claim local and then fail the load.
      expect(checked).toEqual(['/models/Org/model-x']);
    });

    it('falls back to remote download when the vendored dir is missing', async () => {
      const configureTransformersEnv = await loadConfigureFn();
      const fakeEnv = {
        allowLocalModels: true,
        useBrowserCache: true,
        localModelPath: undefined as string | undefined,
      };

      const source = configureTransformersEnv(fakeEnv, '/models', 'Org/model-x', () => false);

      expect(source).toBe('remote');
      expect(fakeEnv.allowLocalModels).toBe(false);
      expect(fakeEnv.useBrowserCache).toBe(false);
      expect(fakeEnv.localModelPath).toBeUndefined();
    });
  });
});
