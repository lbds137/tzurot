/**
 * Tests for ReplyReferenceStrategy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageReferenceType } from 'discord.js';
import { ReplyReferenceStrategy } from './ReplyReferenceStrategy.js';
import { ReferenceType } from '../types.js';
import { createMockMessage } from '../../../test/mocks/Discord.mock.js';

describe('ReplyReferenceStrategy', () => {
  let strategy: ReplyReferenceStrategy;

  beforeEach(() => {
    strategy = new ReplyReferenceStrategy();
  });

  it('should return empty array for non-reply message', async () => {
    const message = createMockMessage({
      reference: null,
    });

    const result = await strategy.extract(message);

    expect(result).toEqual([]);
  });

  it('should extract reply reference with guildId and channelId', async () => {
    const message = createMockMessage({
      id: 'msg-123',
      guildId: 'guild-456',
      channelId: 'channel-789',
      reference: { messageId: 'referenced-999' } as any,
    });

    const result = await strategy.extract(message);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: 'referenced-999',
      channelId: 'channel-789',
      guildId: 'guild-456',
      type: ReferenceType.REPLY,
    });
  });

  it('should extract reply reference for DM messages (null guildId)', async () => {
    // Regression: native Discord replies sent FROM a DM have `message.guildId === null`
    // per discord.js semantics. The strategy must still extract the reply reference;
    // the downstream fetcher resolves the channel via `client.channels.fetch(channelId)`
    // and access is verified via `LinkExtractor.verifyInvokerCanAccessSource`'s
    // DM-aware branch (`channel.isDMBased()` → `recipientId === invokerId`).
    const message = createMockMessage({
      id: 'msg-123',
      guildId: null,
      channelId: 'channel-789',
      reference: { messageId: 'referenced-999' } as any,
    });

    const result = await strategy.extract(message);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: 'referenced-999',
      channelId: 'channel-789',
      guildId: null,
      type: ReferenceType.REPLY,
    });
  });

  it('should return empty array if channelId is missing', async () => {
    const message = createMockMessage({
      guildId: 'guild-456',
      channelId: null as any,
      reference: { messageId: 'referenced-999' } as any,
    });

    const result = await strategy.extract(message);

    expect(result).toEqual([]);
  });

  it('should return empty array for forwarded messages (reference.type === Forward)', async () => {
    // Discord's Message Forwarding feature also populates `message.reference` but with
    // `type === MessageReferenceType.Forward`. Forwards are handled separately via
    // message snapshots and must NOT be treated as reply references here.
    const message = createMockMessage({
      id: 'msg-123',
      guildId: 'guild-456',
      channelId: 'channel-789',
      reference: {
        messageId: 'referenced-999',
        type: MessageReferenceType.Forward,
      } as any,
    });

    const result = await strategy.extract(message);

    expect(result).toEqual([]);
  });
});
