/**
 * Tests for userGatewayClient utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfig } from '@tzurot/common-types';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: vi.fn().mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    }),
    CONTENT_TYPES: {
      JSON: 'application/json',
    },
  };
});

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Get the mocked getConfig
const mockGetConfig = vi.mocked(getConfig);

import {
  getGatewayUrl,
  isGatewayConfigured,
  parseErrorResponse,
  callGatewayApi,
  GATEWAY_TIMEOUTS,
} from './userGatewayClient.js';

// Helper to create mock config with defaults
function createMockConfig(overrides: Record<string, unknown> = {}) {
  return {
    GATEWAY_URL: 'http://localhost:3000',
    INTERNAL_SERVICE_SECRET: 'test-service-secret',
    ...overrides,
  } as ReturnType<typeof getConfig>;
}

describe('userGatewayClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetConfig.mockReturnValue(createMockConfig());
  });

  describe('getGatewayUrl', () => {
    it('should return configured gateway URL', () => {
      mockGetConfig.mockReturnValue(createMockConfig({ GATEWAY_URL: 'http://test-gateway.com' }));

      const url = getGatewayUrl();

      expect(url).toBe('http://test-gateway.com');
    });

    it('should throw when GATEWAY_URL is not configured', () => {
      mockGetConfig.mockReturnValue(createMockConfig({ GATEWAY_URL: undefined }));

      expect(() => getGatewayUrl()).toThrow('GATEWAY_URL not configured');
    });

    it('should throw when GATEWAY_URL is empty', () => {
      mockGetConfig.mockReturnValue(createMockConfig({ GATEWAY_URL: '' }));

      expect(() => getGatewayUrl()).toThrow('GATEWAY_URL not configured');
    });
  });

  describe('isGatewayConfigured', () => {
    it('should return true when gateway is configured', () => {
      mockGetConfig.mockReturnValue(createMockConfig({ GATEWAY_URL: 'http://localhost:3000' }));

      expect(isGatewayConfigured()).toBe(true);
    });

    it('should return false when gateway is not configured', () => {
      mockGetConfig.mockReturnValue(createMockConfig({ GATEWAY_URL: undefined }));

      expect(isGatewayConfigured()).toBe(false);
    });
  });

  describe('parseErrorResponse', () => {
    it('should extract error from JSON response', async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({ error: 'Test error' }),
        status: 400,
      } as unknown as Response;

      const result = await parseErrorResponse(mockResponse);

      expect(result.message).toBe('Test error');
      expect(result.code).toBeUndefined();
    });

    it('should extract message from JSON response', async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({ message: 'Test message' }),
        status: 400,
      } as unknown as Response;

      const result = await parseErrorResponse(mockResponse);

      expect(result.message).toBe('Test message');
      expect(result.code).toBeUndefined();
    });

    it('should prefer message over error code when both present', async () => {
      // API returns { error: 'VALIDATION_ERROR', message: 'No default config set' }
      // We want the human-readable message, not the error code
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          error: 'VALIDATION_ERROR',
          message: 'No default config set',
        }),
        status: 400,
      } as unknown as Response;

      const result = await parseErrorResponse(mockResponse);

      expect(result.message).toBe('No default config set');
      expect(result.code).toBeUndefined();
    });

    it('should return HTTP status when JSON parsing fails', async () => {
      const mockResponse = {
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
        status: 500,
      } as unknown as Response;

      const result = await parseErrorResponse(mockResponse);

      expect(result.message).toBe('HTTP 500');
      expect(result.code).toBeUndefined();
    });

    it('should surface the machine-readable sub-code when the response body carries one', async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({
          error: 'VALIDATION_ERROR',
          message: 'You already have a config named "Foo (Copy)"',
          code: 'NAME_COLLISION',
        }),
        status: 400,
      } as unknown as Response;

      const result = await parseErrorResponse(mockResponse);

      expect(result.message).toBe('You already have a config named "Foo (Copy)"');
      expect(result.code).toBe('NAME_COLLISION');
    });
  });

  describe('callGatewayApi', () => {
    it('should make successful GET request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      });

      const result = await callGatewayApi<{ data: string }>('/test', {
        userId: 'user-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ data: 'test' });
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-Service-Auth': 'test-service-secret',
            'X-User-Id': 'user-123',
          },
        })
      );
    });

    it('should make POST request with body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await callGatewayApi('/test', {
        method: 'POST',
        userId: 'user-123',
        body: { key: 'value' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/test',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'X-Service-Auth': 'test-service-secret',
            'X-User-Id': 'user-123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key: 'value' }),
        })
      );
    });

    it('should return error for non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'Not found' }),
      });

      const result = await callGatewayApi('/test', { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Not found');
        expect(result.status).toBe(404);
      }
    });

    it('should propagate code sub-classifier from gateway response body', async () => {
      // Closes the parseErrorResponse → callGatewayApi → GatewayError
      // chain. Without this test the middle link could silently drop
      // the `code` field and only be caught at runtime.
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: 'VALIDATION_ERROR',
          message: 'You already have a config named "Foo"',
          code: 'NAME_COLLISION',
        }),
      });

      const result = await callGatewayApi('/test', { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('You already have a config named "Foo"');
        expect(result.status).toBe(400);
        expect(result.code).toBe('NAME_COLLISION');
      }
    });

    it('should leave code undefined when the gateway response has no sub-code', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: 'Internal error' }),
      });

      const result = await callGatewayApi('/test', { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBeUndefined();
      }
    });

    it('should handle fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await callGatewayApi('/test', { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Network error');
        expect(result.status).toBe(0);
      }
    });

    it('should use default timeout (AUTOCOMPLETE) when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      });

      await callGatewayApi('/test', { userId: 'user-123' });

      // Verify AbortSignal.timeout was called with default (2500ms)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should use custom timeout when specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      });

      await callGatewayApi('/test', {
        userId: 'user-123',
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      });

      // Verify fetch was called with signal (timeout is internal to AbortSignal)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new DOMException('Signal timed out', 'TimeoutError');
      mockFetch.mockRejectedValue(timeoutError);

      const result = await callGatewayApi('/test', { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Request timeout (gateway slow or unavailable)');
        expect(result.status).toBe(0);
      }
    });
  });

  describe('GATEWAY_TIMEOUTS', () => {
    it('should have AUTOCOMPLETE timeout of 2500ms', () => {
      expect(GATEWAY_TIMEOUTS.AUTOCOMPLETE).toBe(2500);
    });

    it('should have DEFERRED timeout of 10000ms', () => {
      expect(GATEWAY_TIMEOUTS.DEFERRED).toBe(10000);
    });

    it('should have DEFERRED longer than AUTOCOMPLETE', () => {
      expect(GATEWAY_TIMEOUTS.DEFERRED).toBeGreaterThan(GATEWAY_TIMEOUTS.AUTOCOMPLETE);
    });

    it('should have BULK_OPERATION timeout of 30000ms', () => {
      expect(GATEWAY_TIMEOUTS.BULK_OPERATION).toBe(30000);
    });

    it('should have BULK_OPERATION longer than DEFERRED', () => {
      expect(GATEWAY_TIMEOUTS.BULK_OPERATION).toBeGreaterThan(GATEWAY_TIMEOUTS.DEFERRED);
    });
  });
});
