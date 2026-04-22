/**
 * Tests for Key Validation Service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  KeyValidationService,
  InvalidApiKeyError,
  QuotaExceededError,
  ValidationTimeoutError,
} from './KeyValidationService.js';
import { AIProvider } from '@tzurot/common-types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the logger (preserve all other exports including VALIDATION_TIMEOUTS)
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

/** Sentinel message thrown by tests to trigger the mock's timeout path.
 * Only used in this test file — not a real error from any production code. */
const MOCK_TIMEOUT_SIGNAL = 'MOCK_TIMEOUT_SIGNAL';

// Mock withTimeout while preserving real TimeoutError class for instanceof checks.
// TimeoutError moved to @tzurot/common-types in the 2026-04-21 extraction, so we
// pull it from there rather than re-importing retry.js (which no longer exports it).
vi.mock('../utils/retry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/retry.js')>();
  const { TimeoutError } =
    await vi.importActual<typeof import('@tzurot/common-types')>('@tzurot/common-types');
  return {
    ...actual,
    withTimeout: async <T>(
      fn: (signal: AbortSignal) => Promise<T>,
      timeout: number,
      operation: string
    ): Promise<T> => {
      const controller = new AbortController();
      try {
        return await fn(controller.signal);
      } catch (error) {
        if (error instanceof Error && error.message === MOCK_TIMEOUT_SIGNAL) {
          throw new TimeoutError(timeout, operation, error);
        }
        throw error;
      }
    },
  };
});

describe('KeyValidationService', () => {
  let service: KeyValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KeyValidationService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateKey', () => {
    describe('OpenRouter validation', () => {
      it('should return valid=true for valid OpenRouter key', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              label: 'My Key',
              usage: 10.5,
              limit: 100,
              is_free_tier: false,
            },
          }),
        });

        const result = await service.validateKey('sk-or-valid-key', AIProvider.OpenRouter);

        expect(result.valid).toBe(true);
        expect(result.provider).toBe(AIProvider.OpenRouter);
        expect(result.metadata?.creditBalance).toBe(89.5);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://openrouter.ai/api/v1/auth/key',
          expect.objectContaining({
            method: 'GET',
            headers: {
              Authorization: 'Bearer sk-or-valid-key',
            },
          })
        );
      });

      it('should throw InvalidApiKeyError for 401 response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
        });

        const result = await service.validateKey('sk-or-invalid', AIProvider.OpenRouter);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(InvalidApiKeyError);
        expect((result.error as InvalidApiKeyError).provider).toBe(AIProvider.OpenRouter);
      });

      it('should throw QuotaExceededError for 402 response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 402,
        });

        const result = await service.validateKey('sk-or-no-credits', AIProvider.OpenRouter);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(QuotaExceededError);
        expect((result.error as QuotaExceededError).provider).toBe(AIProvider.OpenRouter);
      });

      it('should throw QuotaExceededError for 429 response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 429,
        });

        const result = await service.validateKey('sk-or-rate-limited', AIProvider.OpenRouter);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(QuotaExceededError);
      });

      it('should handle OpenRouter response without usage data', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              label: 'My Key',
              // No usage/limit data
            },
          }),
        });

        const result = await service.validateKey('sk-or-valid', AIProvider.OpenRouter);

        expect(result.valid).toBe(true);
        expect(result.metadata?.creditBalance).toBeUndefined();
      });

      it('should handle network errors', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));

        const result = await service.validateKey('sk-or-key', AIProvider.OpenRouter);

        expect(result.valid).toBe(false);
        expect(result.error?.message).toBe('Network error');
      });

      it('should handle timeout errors', async () => {
        mockFetch.mockRejectedValue(new Error(MOCK_TIMEOUT_SIGNAL));

        const result = await service.validateKey('sk-or-slow', AIProvider.OpenRouter);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(ValidationTimeoutError);
      });
    });

    describe('ElevenLabs validation', () => {
      it('should return valid=true for valid ElevenLabs key', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscription: { character_count: 500, character_limit: 10000 },
          }),
        });

        const result = await service.validateKey('sk_valid_key', AIProvider.ElevenLabs);

        expect(result.valid).toBe(true);
        expect(result.provider).toBe(AIProvider.ElevenLabs);
        expect(result.metadata?.creditBalance).toBe(9500);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.elevenlabs.io/v1/user',
          expect.objectContaining({
            method: 'GET',
            headers: { 'xi-api-key': 'sk_valid_key' },
          })
        );
      });

      it('should throw InvalidApiKeyError for 401 response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
        });

        const result = await service.validateKey('sk_invalid', AIProvider.ElevenLabs);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(InvalidApiKeyError);
        expect((result.error as InvalidApiKeyError).provider).toBe(AIProvider.ElevenLabs);
      });

      it('should throw QuotaExceededError when characters exhausted', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscription: { character_count: 10000, character_limit: 10000 },
          }),
        });

        const result = await service.validateKey('sk_exhausted', AIProvider.ElevenLabs);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(QuotaExceededError);
      });

      it('should handle missing subscription info', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({}),
        });

        const result = await service.validateKey('sk_key', AIProvider.ElevenLabs);

        expect(result.valid).toBe(true);
        expect(result.metadata?.creditBalance).toBeUndefined();
      });

      it('should handle timeout errors', async () => {
        mockFetch.mockRejectedValue(new Error(MOCK_TIMEOUT_SIGNAL));

        const result = await service.validateKey('sk_slow', AIProvider.ElevenLabs);

        expect(result.valid).toBe(false);
        expect(result.error).toBeInstanceOf(ValidationTimeoutError);
      });
    });
  });

  describe('error classes', () => {
    it('InvalidApiKeyError should have correct properties', () => {
      const error = new InvalidApiKeyError(AIProvider.OpenRouter, 'test reason');

      expect(error.name).toBe('InvalidApiKeyError');
      expect(error.provider).toBe(AIProvider.OpenRouter);
      expect(error.reason).toBe('test reason');
      expect(error.message).toContain('openrouter');
      expect(error.message).toContain('test reason');
    });

    it('QuotaExceededError should have correct properties', () => {
      const error = new QuotaExceededError(AIProvider.OpenRouter, 'no credits');

      expect(error.name).toBe('QuotaExceededError');
      expect(error.provider).toBe(AIProvider.OpenRouter);
      expect(error.details).toBe('no credits');
      expect(error.message).toContain('openrouter');
    });

    it('QuotaExceededError should work without details', () => {
      const error = new QuotaExceededError(AIProvider.OpenRouter);

      expect(error.name).toBe('QuotaExceededError');
      expect(error.details).toBeUndefined();
      expect(error.message).not.toContain('undefined');
    });

    it('ValidationTimeoutError should have correct properties', () => {
      const error = new ValidationTimeoutError(AIProvider.OpenRouter);

      expect(error.name).toBe('ValidationTimeoutError');
      expect(error.provider).toBe(AIProvider.OpenRouter);
      expect(error.message).toContain('timed out');
    });
  });
});
