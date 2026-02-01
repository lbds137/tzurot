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
} from './userGatewayClient.js';

describe('userGatewayClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetConfig.mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    });
  });

  describe('getGatewayUrl', () => {
    it('should return configured gateway URL', () => {
      mockGetConfig.mockReturnValue({ GATEWAY_URL: 'http://test-gateway.com' });

      const url = getGatewayUrl();

      expect(url).toBe('http://test-gateway.com');
    });

    it('should throw when GATEWAY_URL is not configured', () => {
      mockGetConfig.mockReturnValue({ GATEWAY_URL: undefined });

      expect(() => getGatewayUrl()).toThrow('GATEWAY_URL not configured');
    });

    it('should throw when GATEWAY_URL is empty', () => {
      mockGetConfig.mockReturnValue({ GATEWAY_URL: '' });

      expect(() => getGatewayUrl()).toThrow('GATEWAY_URL not configured');
    });
  });

  describe('isGatewayConfigured', () => {
    it('should return true when gateway is configured', () => {
      mockGetConfig.mockReturnValue({ GATEWAY_URL: 'http://localhost:3000' });

      expect(isGatewayConfigured()).toBe(true);
    });

    it('should return false when gateway is not configured', () => {
      mockGetConfig.mockReturnValue({ GATEWAY_URL: undefined });

      expect(isGatewayConfigured()).toBe(false);
    });
  });

  describe('parseErrorResponse', () => {
    it('should extract error from JSON response', async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({ error: 'Test error' }),
        status: 400,
      } as unknown as Response;

      const error = await parseErrorResponse(mockResponse);

      expect(error).toBe('Test error');
    });

    it('should extract message from JSON response', async () => {
      const mockResponse = {
        json: vi.fn().mockResolvedValue({ message: 'Test message' }),
        status: 400,
      } as unknown as Response;

      const error = await parseErrorResponse(mockResponse);

      expect(error).toBe('Test message');
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

      const error = await parseErrorResponse(mockResponse);

      expect(error).toBe('No default config set');
    });

    it('should return HTTP status when JSON parsing fails', async () => {
      const mockResponse = {
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
        status: 500,
      } as unknown as Response;

      const error = await parseErrorResponse(mockResponse);

      expect(error).toBe('HTTP 500');
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

    it('should handle fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await callGatewayApi('/test', { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Network error');
        expect(result.status).toBe(0);
      }
    });
  });
});
