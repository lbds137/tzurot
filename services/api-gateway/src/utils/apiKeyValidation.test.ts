/**
 * Tests for the API Key Validation Dispatcher
 *
 * Per-provider validators have their own colocated test files in
 * `./apiKeyValidation/{provider}.test.ts`. This file only verifies that
 * `validateApiKey` routes to the right validator for each AIProvider value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { validateApiKey } from './apiKeyValidation.js';

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

describe('validateApiKey (dispatcher)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes OpenRouter keys to validateOpenRouterKey', async () => {
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

  it('routes ElevenLabs keys to validateElevenLabsKey', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subscription: { character_count: 0, character_limit: 10000 } }),
    });

    const result = await validateApiKey('sk_eleven_key', AIProvider.ElevenLabs);

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/user', expect.any(Object));
  });

  it('routes Mistral keys to validateMistralKey', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const result = await validateApiKey('mi-key', AIProvider.Mistral);

    expect(result.valid).toBe(true);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('mistral.ai');
    expect(url).toContain('/models');
  });

  it('routes ZaiCoding keys to validateZaiCodingKey', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const result = await validateApiKey('zai-key', AIProvider.ZaiCoding);

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.z.ai/api/coding/paas/v4/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
