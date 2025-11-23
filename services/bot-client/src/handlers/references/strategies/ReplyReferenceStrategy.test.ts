/**
 * Tests for ReplyReferenceStrategy
 */

import { describe, it, expect, beforeEach } from 'vitest';
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

  it('should return empty array if guildId is missing', async () => {
    const message = createMockMessage({
      guildId: null,
      channelId: 'channel-789',
      reference: { messageId: 'referenced-999' } as any,
    });

    const result = await strategy.extract(message);

    expect(result).toEqual([]);
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

  it('should return empty array if both guildId and channelId are missing', async () => {
    const message = createMockMessage({
      guildId: null,
      channelId: null as any,
      reference: { messageId: 'referenced-999' } as any,
    });

    const result = await strategy.extract(message);

    expect(result).toEqual([]);
  });
});
