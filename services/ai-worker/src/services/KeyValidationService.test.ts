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

// Mock the retryService withTimeout function
vi.mock('../utils/retryService.js', async () => {
  return {
    withTimeout: async <T>(
      fn: (signal: AbortSignal) => Promise<T>,
      _timeout: number,
      operation: string
    ): Promise<T> => {
      const controller = new AbortController();
      try {
        return await fn(controller.signal);
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMEOUT') {
          throw new Error(`${operation} timed out`);
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
        mockFetch.mockRejectedValue(new Error('TIMEOUT'));

        const result = await service.validateKey('sk-or-slow', AIProvider.OpenRouter);

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
