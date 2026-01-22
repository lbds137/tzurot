/**
 * Tests for AI constants and utilities
 */

import { describe, it, expect } from 'vitest';
import { isFreeModel, GUEST_MODE } from './ai.js';

describe('isFreeModel', () => {
  it('should return true for models ending with :free', () => {
    expect(isFreeModel('x-ai/grok-4.1-fast:free')).toBe(true);
    expect(isFreeModel('nvidia/nemotron-nano-12b-v2-vl:free')).toBe(true);
    expect(isFreeModel('tngtech/tng-r1t-chimera:free')).toBe(true);
  });

  it('should return false for paid models', () => {
    expect(isFreeModel('anthropic/claude-haiku-4.5')).toBe(false);
    expect(isFreeModel('openai/gpt-4o')).toBe(false);
    expect(isFreeModel('google/gemini-2.0-flash')).toBe(false);
  });

  it('should return false for models containing :free but not ending with it', () => {
    expect(isFreeModel('x-ai/grok-4.1-fast:free:extended')).toBe(false);
    expect(isFreeModel(':free/some-model')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isFreeModel('')).toBe(false);
    expect(isFreeModel(':free')).toBe(true);
    expect(isFreeModel('model:FREE')).toBe(false); // case sensitive
  });
});

describe('GUEST_MODE', () => {
  it('should have a default free model configured', () => {
    expect(GUEST_MODE.DEFAULT_MODEL).toBe('google/gemma-3-27b-it:free');
    expect(isFreeModel(GUEST_MODE.DEFAULT_MODEL)).toBe(true);
  });

  it('should have all FREE_MODELS be actually free', () => {
    for (const model of GUEST_MODE.FREE_MODELS) {
      expect(isFreeModel(model)).toBe(true);
    }
  });

  it('should have a footer message', () => {
    expect(GUEST_MODE.FOOTER_MESSAGE).toContain('free');
  });
});
