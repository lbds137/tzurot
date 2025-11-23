/**
 * Tests for LinkReferenceStrategy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LinkReferenceStrategy } from './LinkReferenceStrategy.js';
import { ReferenceType } from '../types.js';
import { createMockMessage } from '../../../test/mocks/Discord.mock.js';

describe('LinkReferenceStrategy', () => {
  let strategy: LinkReferenceStrategy;

  beforeEach(() => {
    strategy = new LinkReferenceStrategy();
  });

  it('should return empty array for message with no links', async () => {
    const message = createMockMessage({
      content: 'Hello world',
    });

    const result = await strategy.extract(message);

    expect(result).toEqual([]);
  });

  it('should extract single message link', async () => {
    const message = createMockMessage({
      content: 'Check this https://discord.com/channels/123/456/789',
    });

    const result = await strategy.extract(message);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: '789',
      channelId: '456',
      guildId: '123',
      type: ReferenceType.LINK,
      discordUrl: 'https://discord.com/channels/123/456/789',
    });
  });

  it('should extract multiple message links', async () => {
    const message = createMockMessage({
      content:
        'See https://discord.com/channels/111/222/333 and https://discord.com/channels/444/555/666',
    });

    const result = await strategy.extract(message);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      messageId: '333',
      channelId: '222',
      guildId: '111',
      type: ReferenceType.LINK,
      discordUrl: 'https://discord.com/channels/111/222/333',
    });
    expect(result[1]).toEqual({
      messageId: '666',
      channelId: '555',
      guildId: '444',
      type: ReferenceType.LINK,
      discordUrl: 'https://discord.com/channels/444/555/666',
    });
  });

  it('should handle links with surrounding text', async () => {
    const message = createMockMessage({
      content:
        'Look at this message: https://discord.com/channels/123/456/789 - pretty cool right?',
    });

    const result = await strategy.extract(message);

    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('789');
  });

  it('should handle discord.com and ptb.discord.com links', async () => {
    const message = createMockMessage({
      content: 'https://ptb.discord.com/channels/123/456/789',
    });

    const result = await strategy.extract(message);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: '789',
      channelId: '456',
      guildId: '123',
      type: ReferenceType.LINK,
      discordUrl: 'https://ptb.discord.com/channels/123/456/789',
    });
  });
});
