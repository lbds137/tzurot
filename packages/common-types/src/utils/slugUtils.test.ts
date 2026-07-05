/**
 * Slug Utilities Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeSlugForUser } from './slugUtils.js';

// Mock ownerMiddleware for isBotOwner control
vi.mock('./ownerMiddleware.js', () => ({
  isBotOwner: vi.fn().mockReturnValue(false),
}));

import { isBotOwner } from './ownerMiddleware.js';

describe('normalizeSlugForUser', () => {
  beforeEach(() => {
    vi.mocked(isBotOwner).mockReturnValue(false);
  });

  describe('bot owner', () => {
    it('should return slug as-is for bot owner', () => {
      vi.mocked(isBotOwner).mockReturnValue(true);

      const result = normalizeSlugForUser('lilith', 'owner-123', 'lbds137');

      expect(result).toBe('lilith');
    });

    it('should not append suffix even with special username', () => {
      vi.mocked(isBotOwner).mockReturnValue(true);

      const result = normalizeSlugForUser('my-char', 'owner-123', 'Cool_User!123');

      expect(result).toBe('my-char');
    });
  });

  describe('regular user', () => {
    it('should append username suffix for non-bot-owner', () => {
      const result = normalizeSlugForUser('lilith', 'user-456', 'cooluser');

      expect(result).toBe('lilith-cooluser');
    });

    it('should sanitize username with special characters', () => {
      const result = normalizeSlugForUser('my-char', 'user-456', 'Cool_User!123');

      expect(result).toBe('my-char-cool-user-123');
    });

    it('should handle username with underscores', () => {
      const result = normalizeSlugForUser('test-bot', 'user-456', 'user_with_underscores');

      expect(result).toBe('test-bot-user-with-underscores');
    });

    it('should remove consecutive hyphens in sanitized username', () => {
      const result = normalizeSlugForUser('char', 'user-456', 'user--name');

      expect(result).toBe('char-user-name');
    });

    it('should trim leading and trailing hyphens from username', () => {
      const result = normalizeSlugForUser('char', 'user-456', '--username--');

      expect(result).toBe('char-username');
    });

    it('should lowercase the username', () => {
      const result = normalizeSlugForUser('char', 'user-456', 'CamelCaseUser');

      expect(result).toBe('char-camelcaseuser');
    });
  });

  describe('idempotency', () => {
    it('does not double-suffix an already-normalized slug for the same user', () => {
      // Without idempotency: 'lilith-bob' → 'lilith-bob-bob'. With it: stays 'lilith-bob'.
      const result = normalizeSlugForUser('lilith-bob', 'user-456', 'bob');
      expect(result).toBe('lilith-bob');
    });

    it('still appends suffix when slug ends in a different username', () => {
      // 'lilith-alice' from user 'bob' should become 'lilith-alice-bob' — alice's suffix
      // is part of the base slug from bob's perspective, not bob's own suffix.
      const result = normalizeSlugForUser('lilith-alice', 'user-456', 'bob');
      expect(result).toBe('lilith-alice-bob');
    });

    it('idempotent on the user-id fallback suffix when username sanitizes empty', () => {
      const result = normalizeSlugForUser('char-user-456', 'user-456', '!!!');
      expect(result).toBe('char-user-456');
    });

    it('preserves the username suffix intact when an already-suffixed slug is over-length', () => {
      // Reachable via shapes imports (no length cap before normalization): a long
      // slug that already ends in this user's suffix must truncate the BASE only —
      // eating into the `-username` provenance tail would break the guarantee the
      // fresh-suffix path provides.
      const longBase = 'a'.repeat(60);
      const result = normalizeSlugForUser(`${longBase}-bob`, 'user-456', 'bob');

      expect(result.length).toBeLessThanOrEqual(50);
      expect(result.endsWith('-bob')).toBe(true);
      // The truncated base carries the disambiguation hash before the suffix.
      expect(result).toMatch(/-[0-9a-f]{6}-bob$/);
    });

    it('is stable when re-normalizing its own over-length output', () => {
      // normalize(normalize(x)) === normalize(x): the truncated result is under the
      // cap and already suffixed, so a second pass must return it unchanged.
      const first = normalizeSlugForUser(`${'a'.repeat(60)}-bob`, 'user-456', 'bob');
      const second = normalizeSlugForUser(first, 'user-456', 'bob');
      expect(second).toBe(first);
    });
  });

  describe('edge cases', () => {
    it('should fall back to user ID if username sanitizes to empty', () => {
      const result = normalizeSlugForUser('char', 'user-456', '!!!');

      expect(result).toBe('char-user-456');
    });

    it('should fall back to user ID for empty username', () => {
      const result = normalizeSlugForUser('char', 'user-789', '');

      expect(result).toBe('char-user-789');
    });

    it('caps slug + max-length (32-char) username to SLUG_MAX_LENGTH', () => {
      const maxUsername = 'a'.repeat(32); // Discord username hard max
      const result = normalizeSlugForUser(
        'a-long-base-slug-that-overflows-fifty',
        'user-456',
        maxUsername
      );

      expect(result.length).toBeLessThanOrEqual(50);
      expect(result.endsWith(`-${maxUsername}`)).toBe(true); // username suffix preserved intact
      expect(result).toMatch(/^[a-z][a-z0-9-]+$/); // still a valid slug
    });

    it('leaves a slug + suffix that already fits untouched', () => {
      expect(normalizeSlugForUser('lilith', 'user-456', 'cooluser')).toBe('lilith-cooluser');
    });

    it('disambiguates two long slugs sharing a truncated prefix (hash of the removed tail)', () => {
      const longUser = 'a'.repeat(32);
      const a = normalizeSlugForUser('shared-prefix-then-divergent-tail-alpha', 'user-1', longUser);
      const b = normalizeSlugForUser('shared-prefix-then-divergent-tail-bravo', 'user-1', longUser);

      expect(a).not.toBe(b); // different removed tails → different hash
      expect(a.length).toBeLessThanOrEqual(50);
    });

    it('caps a long bot-owner slug (no suffix) to SLUG_MAX_LENGTH', () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      const result = normalizeSlugForUser('x'.repeat(80), 'owner-123', 'owner');

      expect(result.length).toBeLessThanOrEqual(50);
      expect(result).toMatch(/^[a-z][a-z0-9-]+$/);
    });
  });
});
