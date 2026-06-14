import { describe, it, expect } from 'vitest';

import { CACHE_KEY_PREFIXES } from './redis-keys.js';

describe('CACHE_KEY_PREFIXES', () => {
  it('exposes the OpenRouter rate-limit prefix matching ai-worker RateLimitCache', () => {
    expect(CACHE_KEY_PREFIXES.RATE_LIMIT_OPENROUTER).toBe('ratelimit:openrouter:');
  });

  it('exposes the OpenRouter credit-exhaustion prefix matching ai-worker CreditExhaustionCache + ops tooling', () => {
    expect(CACHE_KEY_PREFIXES.CREDIT_EXHAUSTION_OPENROUTER).toBe('nocredits:openrouter:');
  });

  it('exposes the vision system-fallback quota prefix matching ai-worker VisionFallbackQuota', () => {
    expect(CACHE_KEY_PREFIXES.VISION_SYSTEM_FALLBACK_QUOTA).toBe('visionfallback:system:');
  });

  it('every prefix ends with a colon (concatenation invariant)', () => {
    for (const prefix of Object.values(CACHE_KEY_PREFIXES)) {
      expect(prefix.endsWith(':')).toBe(true);
    }
  });
});
