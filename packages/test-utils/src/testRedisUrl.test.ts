import { describe, it, expect } from 'vitest';
import { DEFAULT_TEST_REDIS_URL, resolveTestRedisUrl } from './testRedisUrl.js';

describe('resolveTestRedisUrl', () => {
  it('uses a configured URL as-is', () => {
    expect(resolveTestRedisUrl('redis://127.0.0.1:6380')).toBe('redis://127.0.0.1:6380');
  });

  it('falls back to the default when REDIS_URL is unset', () => {
    expect(resolveTestRedisUrl(undefined)).toBe(DEFAULT_TEST_REDIS_URL);
  });

  it('falls back to the default when REDIS_URL is blank', () => {
    expect(resolveTestRedisUrl('')).toBe(DEFAULT_TEST_REDIS_URL);
  });
});
