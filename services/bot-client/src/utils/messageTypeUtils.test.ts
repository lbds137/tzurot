/**
 * Tests for messageTypeUtils
 *
 * Verifies that isUserContentMessage correctly filters Discord message types
 * to only allow user-generated content (Default, Reply, Forward).
 */

import { describe, it, expect } from 'vitest';
import type { Message, MessageSnapshot, Collection } from 'discord.js';
import { MessageType, MessageReferenceType } from 'discord.js';
import { isUserContentMessage } from './messageTypeUtils.js';

/**
 * Create a minimal mock message for testing message type filtering
 */
function createMockMessage(
  type: MessageType,
  options: {
    reference?: Message['reference'];
    messageSnapshots?: Collection<string, MessageSnapshot>;
  } = {}
): Message {
  return {
    type,
    reference: options.reference ?? null,
    messageSnapshots: options.messageSnapshots,
  } as unknown as Message;
}

describe('messageTypeUtils', () => {
  describe('isUserContentMessage', () => {
    describe('user-generated messages (should return true)', () => {
      it('should allow Default messages', () => {
        const message = createMockMessage(MessageType.Default);
        expect(isUserContentMessage(message)).toBe(true);
      });

      it('should allow Reply messages', () => {
        const message = createMockMessage(MessageType.Reply);
        expect(isUserContentMessage(message)).toBe(true);
      });

      it('should allow forwarded messages with snapshots', () => {
        // Create a mock collection with size property
        const messageSnapshots = {
          size: 1,
          values: () => [{}].values(),
        } as unknown as Collection<string, MessageSnapshot>;

        const message = createMockMessage(MessageType.Default, {
          reference: {
            type: MessageReferenceType.Forward,
          } as Message['reference'],
          messageSnapshots,
        });

        expect(isUserContentMessage(message)).toBe(true);
      });
    });

    describe('system messages (should return false)', () => {
      it('should reject ThreadCreated messages', () => {
        const message = createMockMessage(MessageType.ThreadCreated);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject ChannelPinnedMessage messages', () => {
        const message = createMockMessage(MessageType.ChannelPinnedMessage);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject UserJoin messages', () => {
        const message = createMockMessage(MessageType.UserJoin);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject GuildBoost messages', () => {
        const message = createMockMessage(MessageType.GuildBoost);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject GuildBoostTier1 messages', () => {
        const message = createMockMessage(MessageType.GuildBoostTier1);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject GuildBoostTier2 messages', () => {
        const message = createMockMessage(MessageType.GuildBoostTier2);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject GuildBoostTier3 messages', () => {
        const message = createMockMessage(MessageType.GuildBoostTier3);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject ChannelFollowAdd messages', () => {
        const message = createMockMessage(MessageType.ChannelFollowAdd);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject AutoModerationAction messages', () => {
        const message = createMockMessage(MessageType.AutoModerationAction);
        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject ThreadStarterMessage messages', () => {
        const message = createMockMessage(MessageType.ThreadStarterMessage);
        expect(isUserContentMessage(message)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should reject forwarded reference without snapshots', () => {
        const message = createMockMessage(MessageType.ThreadCreated, {
          reference: {
            type: MessageReferenceType.Forward,
          } as Message['reference'],
          messageSnapshots: undefined,
        });

        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should reject forwarded reference with empty snapshots', () => {
        // Create a mock collection with size 0
        const messageSnapshots = {
          size: 0,
          values: () => [].values(),
        } as unknown as Collection<string, MessageSnapshot>;

        const message = createMockMessage(MessageType.ThreadCreated, {
          reference: {
            type: MessageReferenceType.Forward,
          } as Message['reference'],
          messageSnapshots,
        });

        expect(isUserContentMessage(message)).toBe(false);
      });

      it('should allow Default message even with reply reference (normal reply)', () => {
        const message = createMockMessage(MessageType.Reply, {
          reference: {
            type: MessageReferenceType.Default,
            messageId: '123',
          } as Message['reference'],
        });

        expect(isUserContentMessage(message)).toBe(true);
      });
    });
  });
});
