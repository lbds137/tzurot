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
      // Reasoning support is unknown to these stubs — the three-state contract
      // means undefined, so no thinking warning is derived from them.
      supportsReasoning: vi.fn().mockResolvedValue(undefined),
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
      // Reasoning support is unknown to these stubs — the three-state contract
      // means undefined, so no thinking warning is derived from them.
      supportsReasoning: vi.fn().mockResolvedValue(undefined),
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
      // Reasoning support is unknown to these stubs — the three-state contract
      // means undefined, so no thinking warning is derived from them.
      supportsReasoning: vi.fn().mockResolvedValue(undefined),
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
  // Warning collection resolves capabilities, so this stub needs both lookups.
  // Both answer "unknown", which keeps these context-window cases free of
  // thinking warnings — the warning behaviour has its own cases below.
  const mockModelCache = {
    getModelById: vi.fn().mockResolvedValue(null),
    supportsReasoning: vi.fn().mockResolvedValue(undefined),
  } as unknown as OpenRouterModelCache;

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

      expect(result.ok).toBe(true);
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

      expect(result.ok).toBe(true);
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

      expect(result.ok).toBe(false);
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

      expect(result.ok).toBe(true);
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

      expect(result.ok).toBe(true);
      expect(mockValidateModelAndContextWindow).not.toHaveBeenCalled();
      expect(mockGetById).not.toHaveBeenCalled();
    });

    it('validates with body.model directly, still fetching the row for the stored thinking level', async () => {
      // The fetch serves BOTH fallbacks now. A model-only patch needs no model
      // from the row, but the config keeps whatever thinking level it already
      // had, and that level is what the warnings must be judged against — so
      // the row is still read.
      mockGetById.mockResolvedValue({ model: 'stored-model', advancedParameters: {} });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'claude-3-opus' },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(true);
      expect(mockGetById).toHaveBeenCalledWith('cfg-1');
      // The BODY's model still wins over the stored one for validation.
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'claude-3-opus',
        undefined,
        false
      );
    });

    it('skips the row fetch when the body sets both model and thinking level', async () => {
      // Neither field needs a fallback, so there is nothing to read.
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'claude-3-opus', advancedParameters: { thinking: 'high' } },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(true);
      expect(mockGetById).not.toHaveBeenCalled();
    });

    it('runs warning collection for a thinking-only patch instead of skipping it', async () => {
      // A patch carrying only `advancedParameters` used to fall into the no-op
      // skip above, which would silently drop every thinking warning.
      mockGetById.mockResolvedValue({ model: 'z-ai/glm-4.7', advancedParameters: {} });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: undefined,
        body: { advancedParameters: { thinking: 'off' } },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(true);
      expect(mockGetById).toHaveBeenCalledWith('cfg-1');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('cannot disable extended thinking');
    });

    it('warns against the STORED thinking level when the patch omits one', async () => {
      // The effective post-update level is the stored one; a model-only patch
      // onto a config already asking for `off` must still warn.
      mockGetById.mockResolvedValue({
        model: 'some/old-model',
        advancedParameters: { thinking: 'off' },
      });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: undefined,
        body: { model: 'z-ai/glm-5.2' },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(true);
      expect(result.warnings[0]).toContain('best-effort on GLM-5.x');
    });

    it('does not inherit a stored level when the patch replaces advancedParameters without one', async () => {
      // LlmConfigService.update REPLACES the advancedParameters JSONB wholesale
      // whenever the patch carries it, so a params patch without a thinking key
      // REMOVES the level — warning from the stored row here would flag a
      // setting the save just deleted.
      mockGetById.mockResolvedValue({
        model: 'z-ai/glm-4.7',
        advancedParameters: { thinking: 'off' },
      });
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: undefined,
        body: { advancedParameters: {} },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('never hard-validates the stored model on a params-only patch', async () => {
      // A patch touching only advancedParameters changes neither the model nor
      // the context window — a catalog outage or a since-delisted stored model
      // must not 400 it. Warning collection still runs against the effective
      // fields; only the hard-validation leg is skipped.
      mockGetById.mockResolvedValue({ model: 'z-ai/glm-4.7', advancedParameters: {} });
      mockValidateModelAndContextWindow.mockResolvedValue({ error: 'Catalog unreachable' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: undefined,
        body: { advancedParameters: { thinking: 'off' } },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(true);
      expect(mockValidateModelAndContextWindow).not.toHaveBeenCalled();
      expect(result.warnings[0]).toContain('cannot disable extended thinking');
    });

    it('carries no warnings on the error path', async () => {
      // The body must touch a model field — a params-only patch skips hard
      // validation entirely and can no longer reach this error path.
      mockGetById.mockResolvedValue({ model: 'z-ai/glm-4.7', advancedParameters: {} });
      mockValidateModelAndContextWindow.mockResolvedValue({ error: 'Model not found' });

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: undefined,
        body: { model: 'z-ai/glm-4.7', advancedParameters: { thinking: 'off' } },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result.ok).toBe(false);
      expect(result.warnings).toEqual([]);
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

      expect(result.ok).toBe(true);
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

      expect(result.ok).toBe(true);
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

      expect(result.ok).toBe(false);
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

      expect(result.ok).toBe(true);
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        undefined,
        8000,
        false
      );
    });
  });
});
