/**
 * Bot Message Filter Tests
 *
 * Tests filtering of bot messages to prevent bot-to-bot loops.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BotMessageFilter } from './BotMessageFilter.js';
import type { Message } from 'discord.js';

function createMockMessage(options: { authorBot: boolean }): Message {
  return {
    id: '123456789',
    content: 'Test message',
    author: {
      id: options.authorBot ? 'bot-123' : 'user-123',
      username: options.authorBot ? 'testbot' : 'testuser',
      bot: options.authorBot,
    },
  } as unknown as Message;
}

describe('BotMessageFilter', () => {
  let filter: BotMessageFilter;

  beforeEach(() => {
    filter = new BotMessageFilter();
  });

  it('should filter out bot messages', async () => {
    const message = createMockMessage({ authorBot: true });

    const result = await filter.process(message);

    expect(result).toBe(true); // Should stop processing
  });

  it('should allow human messages', async () => {
    const message = createMockMessage({ authorBot: false });

    const result = await filter.process(message);

    expect(result).toBe(false); // Should continue processing
  });
});
