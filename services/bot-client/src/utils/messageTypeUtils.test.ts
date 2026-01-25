/**
 * Tests for messageTypeUtils
 *
 * Verifies that isUserContentMessage correctly filters Discord message types
 * to only allow user-generated content (Default, Reply, Forward).
 */

import { describe, it, expect } from 'vitest';
import type { Message, MessageSnapshot, Collection } from 'discord.js';
import { MessageType, MessageReferenceType } from 'discord.js';
import {
  isUserContentMessage,
  isForwardedMessage,
  getEffectiveContent,
} from './messageTypeUtils.js';

/**
 * Create a minimal mock message for testing message type filtering
 */
function createMockMessage(
  type: MessageType,
  options: {
    reference?: Message['reference'];
    messageSnapshots?: Collection<string, MessageSnapshot>;
    content?: string;
  } = {}
): Message {
  return {
    type,
    reference: options.reference ?? null,
    messageSnapshots: options.messageSnapshots,
    content: options.content ?? '',
  } as unknown as Message;
}

/**
 * Create a mock message snapshot with content
 */
function createMockSnapshot(content: string): MessageSnapshot {
  return {
    message: { content },
  } as unknown as MessageSnapshot;
}

/**
 * Create a mock Collection with snapshots
 */
function createMockSnapshotCollection(
  snapshots: MessageSnapshot[]
): Collection<string, MessageSnapshot> {
  return {
    size: snapshots.length,
    values: () => snapshots.values(),
    first: () => snapshots[0],
  } as unknown as Collection<string, MessageSnapshot>;
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

  describe('isForwardedMessage', () => {
    it('should return true for forwarded message with snapshots', () => {
      const messageSnapshots = createMockSnapshotCollection([createMockSnapshot('forwarded')]);
      const message = createMockMessage(MessageType.Default, {
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      expect(isForwardedMessage(message)).toBe(true);
    });

    it('should return false for regular message', () => {
      const message = createMockMessage(MessageType.Default, {
        content: 'regular message',
      });

      expect(isForwardedMessage(message)).toBe(false);
    });

    it('should return false for reply message', () => {
      const message = createMockMessage(MessageType.Reply, {
        reference: { type: MessageReferenceType.Default } as Message['reference'],
        content: 'reply message',
      });

      expect(isForwardedMessage(message)).toBe(false);
    });

    it('should return false for forward without snapshots', () => {
      const message = createMockMessage(MessageType.Default, {
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots: undefined,
      });

      expect(isForwardedMessage(message)).toBe(false);
    });

    it('should return false for forward with empty snapshots', () => {
      const messageSnapshots = createMockSnapshotCollection([]);
      const message = createMockMessage(MessageType.Default, {
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      expect(isForwardedMessage(message)).toBe(false);
    });
  });

  describe('getEffectiveContent', () => {
    it('should return message.content for regular messages', () => {
      const message = createMockMessage(MessageType.Default, {
        content: 'Hello world!',
      });

      expect(getEffectiveContent(message)).toBe('Hello world!');
    });

    it('should return snapshot content for forwarded messages', () => {
      const messageSnapshots = createMockSnapshotCollection([
        createMockSnapshot('Forwarded content here'),
      ]);
      const message = createMockMessage(MessageType.Default, {
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
        content: '', // Forwarded messages often have empty content
      });

      expect(getEffectiveContent(message)).toBe('Forwarded content here');
    });

    it('should return first snapshot content when multiple snapshots exist', () => {
      const messageSnapshots = createMockSnapshotCollection([
        createMockSnapshot('First message'),
        createMockSnapshot('Second message'),
      ]);
      const message = createMockMessage(MessageType.Default, {
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
        content: '',
      });

      expect(getEffectiveContent(message)).toBe('First message');
    });

    it('should return message.content for forwarded message without snapshot content', () => {
      const messageSnapshots = createMockSnapshotCollection([
        { message: { content: '' } } as unknown as MessageSnapshot,
      ]);
      const message = createMockMessage(MessageType.Default, {
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
        content: 'fallback content',
      });

      // Falls back to message.content when snapshot has empty content
      expect(getEffectiveContent(message)).toBe('fallback content');
    });

    it('should handle reply messages (return message.content)', () => {
      const message = createMockMessage(MessageType.Reply, {
        reference: { type: MessageReferenceType.Default } as Message['reference'],
        content: 'My reply',
      });

      expect(getEffectiveContent(message)).toBe('My reply');
    });
  });
});
