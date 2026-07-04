import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateElevenLabsKey } from './elevenlabs.js';

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

describe('validateElevenLabsKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns valid=true for valid key with character quota remaining', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subscription: { character_count: 1000, character_limit: 10000 } }),
    });

    const result = await validateElevenLabsKey('sk_valid_key');

    expect(result.valid).toBe(true);
    expect(result.credits).toBe(9000);
  });

  it('returns INVALID_KEY for 401 (truly invalid key)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: { status: 'invalid_api_key' } }),
    });

    const result = await validateElevenLabsKey('sk_invalid');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns MISSING_PERMISSIONS for scoped key with insufficient permissions', async () => {
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

  it('falls back to INVALID_KEY when 401 body is not JSON', async () => {
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

  it('returns QUOTA_EXCEEDED when characters exhausted', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subscription: { character_count: 10000, character_limit: 10000 } }),
    });

    const result = await validateElevenLabsKey('sk_exhausted');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('QUOTA_EXCEEDED');
  });

  it('returns valid=true when subscription info is missing', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const result = await validateElevenLabsKey('sk_key');
    expect(result.valid).toBe(true);
    expect(result.credits).toBeUndefined();
  });

  it('sends xi-api-key header', async () => {
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

  it('returns TIMEOUT for aborted request', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    const result = await validateElevenLabsKey('sk_slow');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
  });
});
