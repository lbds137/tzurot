import { describe, it, expect } from 'vitest';
import { ApiErrorCategory } from '../../constants/error.js';
import { TtsProviderError } from './TtsProviderError.js';

describe('TtsProviderError', () => {
  it('carries category, provider, isFallbackEligible, and message', () => {
    const err = new TtsProviderError(
      ApiErrorCategory.RATE_LIMIT,
      'mistral',
      true,
      'Voxtral rate limited'
    );
    expect(err.category).toBe(ApiErrorCategory.RATE_LIMIT);
    expect(err.provider).toBe('mistral');
    expect(err.isFallbackEligible).toBe(true);
    expect(err.message).toBe('Voxtral rate limited');
    expect(err.name).toBe('TtsProviderError');
  });

  it('preserves cause via the cause field', () => {
    const underlying = new Error('connection refused');
    const err = new TtsProviderError(
      ApiErrorCategory.NETWORK,
      'elevenlabs',
      true,
      'wrapped',
      underlying
    );
    expect(err.cause).toBe(underlying);
  });

  it('is detectable via `instanceof TtsProviderError`', () => {
    const err = new TtsProviderError(
      ApiErrorCategory.VOICE_NOT_FOUND,
      'elevenlabs',
      false,
      'voice gone'
    );
    expect(err instanceof TtsProviderError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('round-trips through a thrown-and-caught path', () => {
    const fn = (): void => {
      throw new TtsProviderError(
        ApiErrorCategory.CLONING_FAILED,
        'mistral',
        false,
        'malformed audio'
      );
    };
    try {
      fn();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TtsProviderError);
      const tts = e as TtsProviderError;
      expect(tts.isFallbackEligible).toBe(false);
      expect(tts.provider).toBe('mistral');
    }
  });

  it('carries the documented isFallbackEligible defaults for typical cases', () => {
    // These pairings match the table in the doc comment of TtsProviderError.
    const cases: Array<{ category: ApiErrorCategory; eligible: boolean }> = [
      { category: ApiErrorCategory.RATE_LIMIT, eligible: true },
      { category: ApiErrorCategory.AUTHENTICATION, eligible: true },
      { category: ApiErrorCategory.TIMEOUT, eligible: true },
      { category: ApiErrorCategory.SERVER_ERROR, eligible: true },
      { category: ApiErrorCategory.QUOTA_EXCEEDED, eligible: true },
      { category: ApiErrorCategory.VOICE_NOT_FOUND, eligible: false },
      { category: ApiErrorCategory.CLONING_FAILED, eligible: false },
      { category: ApiErrorCategory.BAD_REQUEST, eligible: false },
    ];
    for (const { category, eligible } of cases) {
      const err = new TtsProviderError(category, 'mistral', eligible, 'test');
      expect(err.category).toBe(category);
      expect(err.isFallbackEligible).toBe(eligible);
    }
  });
});
