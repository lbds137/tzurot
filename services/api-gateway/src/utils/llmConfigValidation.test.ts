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
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(mockModelCache, 'gpt-4', 8000);
      expect(mockSendError).not.toHaveBeenCalled();
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

    it('validates with body.model directly when provided', async () => {
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
        undefined
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
        16000
      );
    });

    it('uses body.model when both model and contextWindowTokens are provided', async () => {
      mockValidateModelAndContextWindow.mockResolvedValue({});

      const result = await validateLlmConfigModelFields({
        res: mockRes,
        modelCache: mockModelCache,
        body: { model: 'new-model', contextWindowTokens: 32000 },
        fallback: { service: mockService, configId: 'cfg-1' },
      });

      expect(result).toBe(true);
      // Should use body.model, not fetch current
      expect(mockGetById).not.toHaveBeenCalled();
      expect(mockValidateModelAndContextWindow).toHaveBeenCalledWith(
        mockModelCache,
        'new-model',
        32000
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
        8000
      );
    });
  });
});
