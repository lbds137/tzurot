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

    it('should handle very long usernames', () => {
      const longUsername = 'a'.repeat(100);
      const result = normalizeSlugForUser('char', 'user-456', longUsername);

      expect(result).toBe(`char-${longUsername}`);
    });
  });
});
