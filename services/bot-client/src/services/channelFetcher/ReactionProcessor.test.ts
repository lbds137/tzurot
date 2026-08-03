/**
 * Tests for ReactionProcessor
 *
 * Unit tests for extractReactions: emoji formatting (unicode vs custom),
 * bot-reactor exclusion, the rate-limiting caps, and graceful degradation
 * when Discord's reactor fetch fails.
 */

import { describe, it, expect, vi } from 'vitest';
import { Collection } from 'discord.js';
import type { Message } from 'discord.js';
import { MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import { extractReactions } from './ReactionProcessor.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

interface MockReactorUser {
  id: string;
  username: string;
  displayName?: string;
  bot: boolean;
}

interface MockReaction {
  emoji: { id: string | null; name: string | null };
  users: {
    fetch: (options?: { limit?: number }) => Promise<Collection<string, MockReactorUser>>;
  };
}

/** Mock reaction whose users.fetch honours the `limit` option, like Discord's does. */
function createMockReaction(
  emoji: { id: string | null; name: string | null },
  users: MockReactorUser[]
): MockReaction {
  return {
    emoji,
    users: {
      fetch: vi.fn().mockImplementation((options?: { limit?: number }) => {
        const userCollection = new Collection<string, MockReactorUser>();
        const limit = options?.limit ?? users.length;
        for (const user of users.slice(0, limit)) {
          userCollection.set(user.id, user);
        }
        return Promise.resolve(userCollection);
      }),
    },
  };
}

/** Minimal message stub carrying only what extractReactions reads. */
function createMockMessage(reactions = new Map<string, MockReaction>()): Message {
  return {
    id: 'msg1',
    reactions: { cache: new Collection(reactions) },
  } as unknown as Message;
}

describe('ReactionProcessor', () => {
  describe('extractReactions', () => {
    it('should extract reactions with unicode emojis', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
          { id: 'user2', username: 'bob', displayName: 'Bob', bot: false },
        ])
      );

      const result = await extractReactions(createMockMessage(reactions));

      expect(result).toHaveLength(1);
      expect(result[0].emoji).toBe('👍');
      expect(result[0].isCustom).toBe(false);
      expect(result[0].reactors).toHaveLength(2);
      expect(result[0].reactors[0].personaId).toBe('discord:user1');
      expect(result[0].reactors[0].displayName).toBe('Alice');
      expect(result[0].reactors[1].personaId).toBe('discord:user2');
      expect(result[0].reactors[1].displayName).toBe('Bob');
    });

    it('should extract reactions with custom emojis', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        'custom123',
        createMockReaction({ id: 'custom123', name: 'pepe' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
        ])
      );

      const result = await extractReactions(createMockMessage(reactions));

      expect(result).toHaveLength(1);
      expect(result[0].emoji).toBe(':pepe:');
      expect(result[0].isCustom).toBe(true);
      expect(result[0].reactors).toHaveLength(1);
    });

    it('should exclude bot reactions', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
          { id: 'bot1', username: 'SomeBot', displayName: 'SomeBot', bot: true },
        ])
      );

      const result = await extractReactions(createMockMessage(reactions));

      expect(result).toHaveLength(1);
      expect(result[0].reactors).toHaveLength(1);
      expect(result[0].reactors[0].displayName).toBe('Alice');
    });

    it('should skip reactions with only bot reactors', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '🤖',
        createMockReaction({ id: null, name: '🤖' }, [
          { id: 'bot1', username: 'Bot1', displayName: 'Bot1', bot: true },
          { id: 'bot2', username: 'Bot2', displayName: 'Bot2', bot: true },
        ])
      );

      const result = await extractReactions(createMockMessage(reactions));

      expect(result).toHaveLength(0);
    });

    it('should limit reaction types to MAX_REACTIONS_PER_MESSAGE', async () => {
      const reactions = new Map<string, MockReaction>();
      const emojis = ['👍', '👎', '❤️', '🎉', '🚀'];
      emojis.forEach((emoji, index) => {
        reactions.set(
          emoji,
          createMockReaction({ id: null, name: emoji }, [
            { id: `user${index}`, username: `user${index}`, bot: false },
          ])
        );
      });
      expect(emojis.length).toBeGreaterThan(MESSAGE_LIMITS.MAX_REACTIONS_PER_MESSAGE);

      const result = await extractReactions(createMockMessage(reactions));

      expect(result).toHaveLength(MESSAGE_LIMITS.MAX_REACTIONS_PER_MESSAGE);
    });

    it('should limit users per reaction to MAX_USERS_PER_REACTION', async () => {
      const users: MockReactorUser[] = [];
      for (let i = 1; i <= MESSAGE_LIMITS.MAX_USERS_PER_REACTION + 5; i++) {
        users.push({ id: `user${i}`, username: `user${i}`, displayName: `User ${i}`, bot: false });
      }

      const reactions = new Map<string, MockReaction>();
      reactions.set('👍', createMockReaction({ id: null, name: '👍' }, users));

      const result = await extractReactions(createMockMessage(reactions));

      expect(result).toHaveLength(1);
      expect(result[0].reactors).toHaveLength(MESSAGE_LIMITS.MAX_USERS_PER_REACTION);
    });

    it('should use username as displayName when displayName not available', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice_123', bot: false }, // No displayName
        ])
      );

      const result = await extractReactions(createMockMessage(reactions));

      expect(result[0].reactors[0].displayName).toBe('alice_123');
    });

    it('should handle reaction user fetch errors gracefully', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set('👍', {
        emoji: { id: null, name: '👍' },
        users: {
          fetch: vi.fn().mockRejectedValue(new Error('Discord API error')),
        },
      });
      reactions.set(
        '❤️',
        createMockReaction({ id: null, name: '❤️' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
        ])
      );

      const result = await extractReactions(createMockMessage(reactions));

      // Should skip the failed reaction but include the successful one
      expect(result).toHaveLength(1);
      expect(result[0].emoji).toBe('❤️');
    });

    it('should return empty array for messages with no reactions', async () => {
      const result = await extractReactions(createMockMessage());

      expect(result).toHaveLength(0);
    });
  });
});
