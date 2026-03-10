/**
 * Tests for ElevenLabs Fetch Helper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { fetchFromElevenLabs } from './elevenLabsFetch.js';

const TestSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

describe('fetchFromElevenLabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return parsed data on successful fetch', async () => {
    const payload = { items: [{ id: '1', name: 'Test' }] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    const result = await fetchFromElevenLabs({
      endpoint: '/test',
      apiKey: 'test-key',
      schema: TestSchema,
      resourceName: 'items',
    });

    expect(result).toEqual({ data: payload });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({
        headers: { 'xi-api-key': 'test-key' },
      })
    );
  });

  it('should return unauthorized ErrorResponse on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const result = await fetchFromElevenLabs({
      endpoint: '/test',
      apiKey: 'bad-key',
      schema: TestSchema,
      resourceName: 'items',
    });

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('UNAUTHORIZED');
      expect(result.errorResponse.message).toContain('invalid or expired');
    }
  });

  it('should return unauthorized ErrorResponse on 403', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const result = await fetchFromElevenLabs({
      endpoint: '/test',
      apiKey: 'bad-key',
      schema: TestSchema,
      resourceName: 'items',
    });

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('UNAUTHORIZED');
    }
  });

  it('should return internalError ErrorResponse on server error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await fetchFromElevenLabs({
      endpoint: '/test',
      apiKey: 'test-key',
      schema: TestSchema,
      resourceName: 'widgets',
    });

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('INTERNAL_ERROR');
      expect(result.errorResponse.message).toBe('Failed to fetch widgets from ElevenLabs');
    }
  });

  it('should return internalError ErrorResponse on Zod parse failure', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    });

    const result = await fetchFromElevenLabs({
      endpoint: '/test',
      apiKey: 'test-key',
      schema: TestSchema,
      resourceName: 'items',
    });

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('INTERNAL_ERROR');
      expect(result.errorResponse.message).toBe('Unexpected response from ElevenLabs API');
    }
  });

  it('should include resourceName in the fetch error message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });

    const result = await fetchFromElevenLabs({
      endpoint: '/models',
      apiKey: 'test-key',
      schema: TestSchema,
      resourceName: 'models',
    });

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.message).toBe('Failed to fetch models from ElevenLabs');
    }
  });
});
