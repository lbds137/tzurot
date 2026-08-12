/**
 * Tests for validateLlmConfigModelFields
 *
 * Covers both create (no fallback) and update (with fallback) paths, plus
 * the subtle "neither field present on update" skip branch that's the main
 * reason this helper earns its keep.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureVisionCapableModel, validateLlmConfigModelFields } from './llmConfigValidation.js';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';
import type { LlmConfigService } from '../services/LlmConfigService.js';

const mockValidateModelAndContextWindow = vi.fn();
vi.mock('./modelValidation.js', () => ({
  validateModelAndContextWindow: (...args: unknown[]) => mockValidateModelAndContextWindow(...args),
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

describe('ensureVisionCapableModel', () => {
  const mockRes = {} as never;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // `ModelCapabilityService.resolve()` returns the same null for "the catalog
  // does not list this model" and "the catalog could not be reached", so the
  // rejection message must not assert either cause. It previously claimed "it
  // isn't in the model catalog" — false during an outage, and untested, which
  // is how it survived.
  it('does not assert a cause when capability cannot be resolved', async () => {
    const modelCache = {
      getModelById: vi.fn().mockResolvedValue(null),
    } as unknown as OpenRouterModelCache;

    const ok = await ensureVisionCapableModel(mockRes, modelCache, 'anthropic/claude-sonnet-4');

    expect(ok).toBe(false);
    const [, body] = mockSendError.mock.calls[0] as [unknown, { message: string }];
    expect(body.message).toContain("Couldn't confirm");
    expect(body.message).toContain('temporarily unreachable');
    // The specific regression: naming absence as THE reason.
    expect(body.message).not.toMatch(/isn't in the model catalog/);
  });

  it('rejects a resolvable model that genuinely lacks vision, and says so plainly', async () => {
    const modelCache = {
      getModelById: vi.fn().mockResolvedValue({
        id: 'some/text-only',
        supportsVision: false,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        contextLength: 128_000,
      }),
    } as unknown as OpenRouterModelCache;

    const ok = await ensureVisionCapableModel(mockRes, modelCache, 'some/text-only');

    expect(ok).toBe(false);
    const [, body] = mockSendError.mock.calls[0] as [unknown, { message: string }];
    expect(body.message).toContain("doesn't support image input");
    // This one CAN name its cause — capability was resolved, not guessed.
    expect(body.message).not.toContain('unreachable');
  });

  it('accepts a resolvable vision-capable model', async () => {
    const modelCache = {
      getModelById: vi.fn().mockResolvedValue({
        id: 'anthropic/claude-sonnet-4',
        supportsVision: true,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        contextLength: 200_000,
      }),
    } as unknown as OpenRouterModelCache;

    expect(await ensureVisionCapableModel(mockRes, modelCache, 'anthropic/claude-sonnet-4')).toBe(
      true
    );
    expect(mockSendError).not.toHaveBeenCalled();
  });
});

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

    it('validates with body.model directly without fetching the row', async () => {
      // The fetch exists only as a model fallback — when the update body
      // carries a model, there's nothing to derive from the stored row.
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'claude-3-opus' },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(true);
      expect(mockGetById).not.toHaveBeenCalled();
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'claude-3-opus',
        undefined,
        false
      );
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
});
