import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateZaiCodingKey } from './zaiCoding.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

describe('validateZaiCodingKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns valid=true for 200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'h' } }] }),
    });

    const result = await validateZaiCodingKey('zai-valid-key');
    expect(result.valid).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it('returns INVALID_KEY for 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await validateZaiCodingKey('zai-bad-key');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns INVALID_KEY for 403', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await validateZaiCodingKey('zai-forbidden');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns QUOTA_EXCEEDED for 429', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    const result = await validateZaiCodingKey('zai-quota-out');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('QUOTA_EXCEEDED');
  });

  it('returns UNKNOWN for other non-2xx responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await validateZaiCodingKey('zai-server-err');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.error).toContain('500');
  });

  it('returns TIMEOUT for aborted request', async () => {
    mockFetch.mockImplementation(() => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const result = await validateZaiCodingKey('zai-slow');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
  });

  it('POSTs to the coding endpoint (not pay-as-you-go)', async () => {
    // Critical: this is the architectural distinction between pay-as-you-go
    // (`/api/paas/v4`) and the coding-plan subscription endpoint
    // (`/api/coding/paas/v4`). Validating the wrong endpoint would silently
    // bill against the wrong tier.
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

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

  it('requests only 1 token to minimize quota cost', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await validateZaiCodingKey('zai-key');

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string) as { max_tokens: number };
    expect(body.max_tokens).toBe(1);
  });
});
