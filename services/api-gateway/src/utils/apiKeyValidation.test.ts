/**
 * Tests for API Key Validation Utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types';
import { validateApiKey, validateOpenRouterKey, validateOpenAIKey } from './apiKeyValidation.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the logger
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

describe('apiKeyValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('validateOpenRouterKey', () => {
    it('should return valid=true for valid key with credits', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { limit_remaining: 50.25 },
        }),
      });

      const result = await validateOpenRouterKey('sk-or-valid-key');

      expect(result.valid).toBe(true);
      expect(result.credits).toBe(50.25);
      expect(result.errorCode).toBeUndefined();
    });

    it('should return valid=false with INVALID_KEY for 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await validateOpenRouterKey('sk-or-invalid');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return valid=false with INVALID_KEY for 403', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
      });

      const result = await validateOpenRouterKey('sk-or-forbidden');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return valid=false with QUOTA_EXCEEDED for zero credits', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { limit_remaining: 0 },
        }),
      });

      const result = await validateOpenRouterKey('sk-or-no-credits');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('QUOTA_EXCEEDED');
      expect(result.credits).toBe(0);
    });

    it('should return valid=true when no credit info available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {},
        }),
      });

      const result = await validateOpenRouterKey('sk-or-key');

      expect(result.valid).toBe(true);
      expect(result.credits).toBeUndefined();
    });

    it('should return valid=false with TIMEOUT for aborted request', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await validateOpenRouterKey('sk-or-slow');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TIMEOUT');
    });

    it('should return valid=false with UNKNOWN for network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await validateOpenRouterKey('sk-or-key');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN');
      expect(result.error).toBe('Network error');
    });

    it('should return valid=false with UNKNOWN for non-ok status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await validateOpenRouterKey('sk-or-key');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN');
      expect(result.error).toBe('HTTP 500');
    });
  });

  describe('validateOpenAIKey', () => {
    it('should return valid=true for valid key', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'gpt-4' }],
        }),
      });

      const result = await validateOpenAIKey('sk-valid-openai');

      expect(result.valid).toBe(true);
    });

    it('should return valid=false with INVALID_KEY for 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await validateOpenAIKey('sk-invalid');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return valid=false with QUOTA_EXCEEDED for 429', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
      });

      const result = await validateOpenAIKey('sk-rate-limited');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('QUOTA_EXCEEDED');
    });

    it('should return valid=false with TIMEOUT for aborted request', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await validateOpenAIKey('sk-slow');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TIMEOUT');
    });

    it('should return valid=false with UNKNOWN for non-ok status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await validateOpenAIKey('sk-key');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN');
      expect(result.error).toBe('HTTP 503');
    });
  });

  describe('validateApiKey', () => {
    it('should route OpenRouter keys to validateOpenRouterKey', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { limit_remaining: 10 } }),
      });

      const result = await validateApiKey('sk-or-key', AIProvider.OpenRouter);

      expect(result.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/auth/key',
        expect.any(Object)
      );
    });

    it('should route OpenAI keys to validateOpenAIKey', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });

      const result = await validateApiKey('sk-key', AIProvider.OpenAI);

      expect(result.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.any(Object)
      );
    });

    it('should return error for unsupported providers', async () => {
      // Cast to AIProvider to simulate a provider that might be added in the future
      const result = await validateApiKey('some-key', 'unknown-provider' as AIProvider);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN');
      expect(result.error).toContain('Unsupported provider');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
