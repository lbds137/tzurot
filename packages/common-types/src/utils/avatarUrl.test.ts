import { describe, it, expect } from 'vitest';
import { avatarUrlPath, AVATAR_URL_PREFIX } from './avatarUrl.js';

describe('avatarUrlPath', () => {
  it('builds the legacy shape without a cache-bust timestamp', () => {
    expect(avatarUrlPath('cold')).toBe('/avatars/cold.png');
  });

  it('builds the path-versioned shape with a cache-bust timestamp', () => {
    expect(avatarUrlPath('cold', 1705827727111)).toBe('/avatars/cold-1705827727111.png');
  });

  it('URI-encodes the slug (SSRF defense-in-depth on the dynamic segment)', () => {
    // A slug like this can't pass creation-time validation, but the helper
    // must not rely on that — encoding is unconditional.
    expect(avatarUrlPath('../etc/passwd')).toBe('/avatars/..%2Fetc%2Fpasswd.png');
    expect(avatarUrlPath('a b?c#d', 5)).toBe('/avatars/a%20b%3Fc%23d-5.png');
  });

  it('exposes the prefix the gateway mounts the avatar router at', () => {
    expect(AVATAR_URL_PREFIX).toBe('/avatars');
  });
});
