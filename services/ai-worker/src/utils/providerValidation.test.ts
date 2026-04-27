/**
 * Tests for providerValidation utility
 */

import { describe, it, expect, vi } from 'vitest';
import { AIProvider } from '@tzurot/common-types';
import { validateAIProvider } from './providerValidation.js';

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

describe('validateAIProvider', () => {
  it('should return AIProvider.OpenRouter for "openrouter"', () => {
    expect(validateAIProvider('openrouter')).toBe(AIProvider.OpenRouter);
  });

  it('should return AIProvider.ZaiCoding for "zai-coding"', () => {
    expect(validateAIProvider('zai-coding')).toBe(AIProvider.ZaiCoding);
  });

  it('should return AIProvider.ElevenLabs for "elevenlabs"', () => {
    expect(validateAIProvider('elevenlabs')).toBe(AIProvider.ElevenLabs);
  });

  it('should fall back to AIProvider.OpenRouter for unknown values', () => {
    // Defensive guard: unknown provider strings (data migration ahead of enum,
    // AuthStep override gap, etc.) fall back to OpenRouter rather than reach
    // ModelFactory with a string that doesn't match any branch.
    expect(validateAIProvider('some-future-provider')).toBe(AIProvider.OpenRouter);
  });

  it('should fall back to AIProvider.OpenRouter for empty string', () => {
    expect(validateAIProvider('')).toBe(AIProvider.OpenRouter);
  });
});
