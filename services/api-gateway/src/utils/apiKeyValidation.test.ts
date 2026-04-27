/**
 * Tests for API Key Validation Utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types';
import {
  validateApiKey,
  validateOpenRouterKey,
  validateElevenLabsKey,
  validateZaiCodingKey,
} from './apiKeyValidation.js';

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

    it('should return valid=true when limit_remaining is null (unlimited)', async () => {
      // OpenRouter returns null for limit_remaining when no limit is set (unlimited account)
      // This was a bug: null <= 0 is true in JavaScript due to type coercion
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { limit_remaining: null },
        }),
      });

      const result = await validateOpenRouterKey('sk-or-unlimited');

      expect(result.valid).toBe(true);
      expect(result.credits).toBeUndefined(); // null is converted to undefined
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

  describe('validateElevenLabsKey', () => {
    it('should return valid=true for valid key with character quota', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscription: { character_count: 1000, character_limit: 10000 },
        }),
      });

      const result = await validateElevenLabsKey('sk_valid_key');

      expect(result.valid).toBe(true);
      expect(result.credits).toBe(9000);
    });

    it('should return valid=false with INVALID_KEY for 401 (truly invalid key)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: { status: 'invalid_api_key' } }),
      });

      const result = await validateElevenLabsKey('sk_invalid');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return valid=false with MISSING_PERMISSIONS for scoped key', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          detail: {
            status: 'missing_permissions',
            message: 'The API key is missing the permission user_read',
          },
        }),
      });

      const result = await validateElevenLabsKey('sk_scoped');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('MISSING_PERMISSIONS');
      expect(result.error).toContain('missing required permissions');
      expect(result.error).toContain('Voices (Write)');
      expect(result.error).toContain('User (Read)');
    });

    it('should fall back to INVALID_KEY when 401 body is not JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => {
          throw new Error('not JSON');
        },
      });

      const result = await validateElevenLabsKey('sk_invalid');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return valid=false with QUOTA_EXCEEDED when characters exhausted', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscription: { character_count: 10000, character_limit: 10000 },
        }),
      });

      const result = await validateElevenLabsKey('sk_exhausted');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('QUOTA_EXCEEDED');
    });

    it('should return valid=true when subscription info is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await validateElevenLabsKey('sk_key');

      expect(result.valid).toBe(true);
      expect(result.credits).toBeUndefined();
    });

    it('should send xi-api-key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ subscription: {} }),
      });

      await validateElevenLabsKey('sk_test_key');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/user',
        expect.objectContaining({
          headers: expect.objectContaining({ 'xi-api-key': 'sk_test_key' }),
        })
      );
    });

    it('should return valid=false with TIMEOUT for aborted request', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await validateElevenLabsKey('sk_slow');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TIMEOUT');
    });
  });

  describe('validateZaiCodingKey', () => {
    it('should return valid=true for 200 response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'h' } }] }),
      });

      const result = await validateZaiCodingKey('zai-valid-key');

      expect(result.valid).toBe(true);
      expect(result.errorCode).toBeUndefined();
    });

    it('should return INVALID_KEY for 401', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await validateZaiCodingKey('zai-bad-key');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return INVALID_KEY for 403', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      const result = await validateZaiCodingKey('zai-forbidden');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should return QUOTA_EXCEEDED for 429', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const result = await validateZaiCodingKey('zai-quota-out');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('QUOTA_EXCEEDED');
    });

    it('should return UNKNOWN for other non-2xx responses', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await validateZaiCodingKey('zai-server-err');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN');
      expect(result.error).toContain('500');
    });

    it('should return TIMEOUT for aborted request', async () => {
      mockFetch.mockImplementation(() => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const result = await validateZaiCodingKey('zai-slow');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TIMEOUT');
    });

    it('should POST to the coding endpoint (not pay-as-you-go)', async () => {
      // Critical: this is the architectural distinction between pay-as-you-go
      // (`/api/paas/v4`) and the coding-plan subscription endpoint
      // (`/api/coding/paas/v4`). Validating the wrong endpoint would silently
      // bill against the wrong tier.
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await validateZaiCodingKey('zai-key');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.z.ai/api/coding/paas/v4/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer zai-key',
          }),
        })
      );
    });

    it('should request only 1 token to minimize quota cost', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      await validateZaiCodingKey('zai-key');

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string) as { max_tokens: number };
      expect(body.max_tokens).toBe(1);
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

    it('should route ElevenLabs keys to validateElevenLabsKey', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ subscription: { character_count: 0, character_limit: 10000 } }),
      });

      const result = await validateApiKey('sk_eleven_key', AIProvider.ElevenLabs);

      expect(result.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/user',
        expect.any(Object)
      );
    });

    it('should route ZaiCoding keys to validateZaiCodingKey', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await validateApiKey('zai-key', AIProvider.ZaiCoding);

      expect(result.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.z.ai/api/coding/paas/v4/chat/completions',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
