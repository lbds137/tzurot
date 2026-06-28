/**
 * Tests for validateLlmConfigModelFields
 *
 * Covers both create (no fallback) and update (with fallback) paths, plus
 * the subtle "neither field present on update" skip branch that's the main
 * reason this helper earns its keep.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateLlmConfigModelFields } from './llmConfigValidation.js';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';
import type { LlmConfigService } from '../services/LlmConfigService.js';

const mockValidateModelAndContextWindow = vi.fn();
vi.mock('./modelValidation.js', () => ({
  validateModelAndContextWindow: (...args: unknown[]) => mockValidateModelAndContextWindow(...args),
}));

// Control the capability resolver so the vision gate can be exercised without a
// real OpenRouter cache. Each instance delegates to the shared mockResolve.
const mockResolve = vi.fn();
vi.mock('../services/ModelCapabilityService.js', () => ({
  ModelCapabilityService: class {
    async resolve(modelId: string) {
      return mockResolve(modelId);
    }
  },
}));

const mockSendError = vi.fn();
vi.mock('./responseHelpers.js', () => ({
  sendError: (...args: unknown[]) => mockSendError(...args),
}));

vi.mock('./errorResponses.js', () => ({
  ErrorResponses: {
    validationError: (msg: string) => ({ error: 'VALIDATION', message: msg }),
  },
}));

describe('validateLlmConfigModelFields', () => {
  const mockRes = {} as never;
  const mockGetById = vi.fn();
  const mockService = { getById: mockGetById } as unknown as LlmConfigService;
  const mockModelCache = {} as unknown as OpenRouterModelCache;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('create path (no fallback)', () => {
    it('returns true and calls validateModelAndContextWindow with body.model', async () => {
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'gpt-4', contextWindowTokens: 8000 },
      });

      expect(result).toBe(true);
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'gpt-4',
        8000,
        false
      );
      expect(mockSendError).not.toHaveBeenCalled();
    });

    it('threads hasZaiCodingKey through to validateModelAndContextWindow', async () => {
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'z-ai/glm-5.2', contextWindowTokens: 100000 },
        hasZaiCodingKey: true,
      });

      expect(result).toBe(true);
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'z-ai/glm-5.2',
        100000,
        true
      );
    });

    it('returns false and sends error when validation fails', async () => {
      mockValidateModelAndContextWindow.mockResolvedValue({ error: 'Model not found' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'invalid-model' },
      });

      expect(result).toBe(false);
      expect(mockSendError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ message: 'Model not found' })
      );
    });

    it('does not fetch current model on create path (no fallback)', async () => {
      mockValidateModelAndContextWindow.mockResolvedValue({});

      await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'gpt-4' },
      });

      expect(mockGetById).not.toHaveBeenCalled();
    });

    it('skips validation gracefully when body.model is absent on create', async () => {
      // Reviewer-flagged edge case: create path with only contextWindowTokens (no model).
      // validateModelAndContextWindow handles modelId === undefined by returning {} — the
      // helper should forward that undefined model without throwing or pre-checking.
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { contextWindowTokens: 8000 },
      });

      expect(result).toBe(true);
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        undefined,
        8000,
        false
      );
      expect(mockSendError).not.toHaveBeenCalled();
    });
  });

  describe('update path (with fallback)', () => {
    it('skips validation entirely when neither model nor contextWindowTokens present', async () => {
      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: {},
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(true);
      expect(mockValidateModelAndContextWindow).not.toHaveBeenCalled();
      expect(mockGetById).not.toHaveBeenCalled();
    });

    it('validates with body.model directly, but fetches the row to derive the immutable kind', async () => {
      // The update path never carries `kind` (it's immutable), so when a model
      // is being set the helper fetches the row to learn the kind for the
      // capability gate. The model itself still comes from body.model, not the row.
      mockGetById.mockResolvedValue({ model: 'old-model', kind: 'text' });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'claude-3-opus' },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(true);
      expect(mockGetById).toHaveBeenCalledWith('cfg-1');
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'claude-3-opus',
        undefined,
        false
      );
      // text config → no capability check
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it('fetches current model when only contextWindowTokens is being updated', async () => {
      mockGetById.mockResolvedValue({ model: 'existing-model' });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { contextWindowTokens: 16000 },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(true);
      expect(mockGetById).toHaveBeenCalledWith('cfg-1');
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'existing-model',
        16000,
        false
      );
    });

    it('uses body.model for context validation when both model and contextWindowTokens are provided', async () => {
      // Model fallback isn't needed (body.model present), but the row is still
      // fetched to derive the immutable kind for the capability gate.
      mockGetById.mockResolvedValue({ model: 'old-model', kind: 'text' });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'new-model', contextWindowTokens: 32000 },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(true);
      // Context validation uses body.model, not the stored model.
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'new-model',
        32000,
        false
      );
    });

    it('returns false and sends error when validation fails on update', async () => {
      // body.model present → the helper fetches the row to derive the kind.
      mockGetById.mockResolvedValue({ model: 'gpt-4', kind: 'text' });
      mockValidateModelAndContextWindow.mockResolvedValue({
        error: 'Context window exceeds 50% of model limit',
      });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'gpt-4', contextWindowTokens: 200000 },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(false);
      expect(mockSendError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ message: 'Context window exceeds 50% of model limit' })
      );
    });

    it('handles current config being null (model becomes undefined)', async () => {
      mockGetById.mockResolvedValue(null);
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { contextWindowTokens: 8000 },
        fallback: { service: mockService, configId: 'missing-cfg' },
      });

      expect(result).toBe(true);
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        undefined,
        8000,
        false
      );
    });
  });

  describe('vision capability gate', () => {
    beforeEach(() => {
      // Context-window validation passes for all capability-gate cases; we're
      // isolating the capability check that runs after it.
      mockValidateModelAndContextWindow.mockResolvedValue({});
    });

    it('accepts a vision config whose model is vision-capable (create path)', async () => {
      mockResolve.mockResolvedValue({ supportsVision: true, source: 'openrouter' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'anthropic/claude-3.5-sonnet' },
        kind: 'vision',
      });

      expect(result).toBe(true);
      expect(mockResolve).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
      expect(mockSendError).not.toHaveBeenCalled();
    });

    it('rejects a vision config whose model is text-only', async () => {
      mockResolve.mockResolvedValue({ supportsVision: false, source: 'openrouter' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'some/text-only-model' },
        kind: 'vision',
      });

      expect(result).toBe(false);
      expect(mockSendError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ message: expect.stringContaining("doesn't support image input") })
      );
    });

    it('rejects a vision config on a z.ai-only (text-only) model', async () => {
      // z.ai coding-plan models resolve to text-only capabilities → fail closed.
      mockResolve.mockResolvedValue({ supportsVision: false, source: 'zai' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'z-ai/glm-5.2' },
        kind: 'vision',
        hasZaiCodingKey: true,
      });

      expect(result).toBe(false);
      expect(mockSendError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ message: expect.stringContaining("doesn't support image input") })
      );
    });

    it('rejects a vision config on a model unknown to all sources (fail closed)', async () => {
      mockResolve.mockResolvedValue(null);

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'made-up/model' },
        kind: 'vision',
      });

      expect(result).toBe(false);
      expect(mockSendError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ message: expect.stringContaining("Couldn't confirm") })
      );
    });

    it('does not capability-check a text config (vision models are also text-capable)', async () => {
      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'anthropic/claude-3.5-sonnet' },
        kind: 'text',
      });

      expect(result).toBe(true);
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it('capability-checks the NEW model on a vision-config update, with kind from the row', async () => {
      // Update path: kind is immutable, derived from the stored row (vision);
      // the model being validated is the new body.model.
      mockGetById.mockResolvedValue({ model: 'old-vision-model', kind: 'vision' });
      mockResolve.mockResolvedValue({ supportsVision: true, source: 'openrouter' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'new-vision-model' },
        fallback: { service: mockService, configId: 'cfg-vision' },
      });

      expect(result).toBe(true);
      expect(mockGetById).toHaveBeenCalledWith('cfg-vision');
      expect(mockResolve).toHaveBeenCalledWith('new-vision-model');
    });

    it('skips the capability check on a context-only update (model unchanged)', async () => {
      // body.model omitted → no model is being set → unchanged model isn't
      // re-validated, even on a vision config.
      mockGetById.mockResolvedValue({ model: 'existing-vision-model', kind: 'vision' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { contextWindowTokens: 16000 },
        fallback: { service: mockService, configId: 'cfg-vision' },
      });

      expect(result).toBe(true);
      expect(mockResolve).not.toHaveBeenCalled();
    });
  });
});
