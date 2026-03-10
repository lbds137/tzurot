import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    getConfig: vi.fn(),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getConfig } from '@tzurot/common-types';
import { fetchVoiceReference } from './voiceReferenceHelper.js';

const mockedGetConfig = vi.mocked(getConfig);

describe('fetchVoiceReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConfig.mockReturnValue({ GATEWAY_URL: 'http://localhost:3000' } as ReturnType<
      typeof getConfig
    >);
  });

  it('returns audioBuffer and contentType on successful fetch', async () => {
    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF header
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
    });

    const result = await fetchVoiceReference('test-slug');

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.length).toBe(4);
    expect(result.contentType).toBe('audio/mpeg');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/test-slug',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('throws when GATEWAY_URL is undefined', async () => {
    mockedGetConfig.mockReturnValue({} as ReturnType<typeof getConfig>);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'GATEWAY_URL not configured — cannot fetch voice reference'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws timeout error on TimeoutError', async () => {
    const timeoutError = new DOMException('The operation timed out', 'TimeoutError');
    mockFetch.mockRejectedValue(timeoutError);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'Gateway fetch timed out for voice reference "test-slug"'
    );
  });

  it('re-throws non-abort fetch errors', async () => {
    const networkError = new Error('ECONNREFUSED');
    mockFetch.mockRejectedValue(networkError);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on non-ok response (404)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'Failed to fetch voice reference for "test-slug": 404 Not Found'
    );
  });

  it('throws on non-ok response (500)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'Failed to fetch voice reference for "test-slug": 500 Internal Server Error'
    );
  });

  it('falls back to audio/wav when content-type header is null', async () => {
    const fakeAudio = new Uint8Array([0x00, 0x01]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
      headers: new Headers(), // No content-type
    });

    const result = await fetchVoiceReference('test-slug');

    expect(result.contentType).toBe('audio/wav');
  });

  it('encodes slug with special characters in URL', async () => {
    const fakeAudio = new Uint8Array([0x00]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
      headers: new Headers({ 'content-type': 'audio/wav' }),
    });

    await fetchVoiceReference('slug with spaces/and../traversal');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/slug%20with%20spaces%2Fand..%2Ftraversal',
      expect.any(Object)
    );
  });
});
