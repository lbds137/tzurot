import { describe, it, expect } from 'vitest';
import { shortModelName } from './modelNames.js';

describe('shortModelName', () => {
  it('strips a single provider prefix', () => {
    expect(shortModelName('z-ai/glm-5.2')).toBe('glm-5.2');
  });

  it('keeps only the last segment of a multi-segment id', () => {
    expect(shortModelName('openrouter/z-ai/glm-5.2')).toBe('glm-5.2');
  });

  it('passes through an unprefixed name', () => {
    expect(shortModelName('glm-5.2')).toBe('glm-5.2');
  });

  it('is idempotent', () => {
    expect(shortModelName(shortModelName('z-ai/glm-5.2'))).toBe('glm-5.2');
  });

  it('falls back to the full id on a trailing slash', () => {
    expect(shortModelName('weird/')).toBe('weird/');
  });
});
