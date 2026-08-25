import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import { messageJobContextToSlotContext } from './messageJobContextToSlotContext.js';
import type { MessageJobContext } from '../services/JobTracker.js';

function buildJobContext(overrides: Partial<MessageJobContext> = {}): MessageJobContext {
  return {
    kind: 'message',
    message: { author: { id: 'author-1' } } as unknown as Message,
    channel: { id: 'channel-1' } as any,
    guildId: 'guild-1',
    clientId: 'bot-1',
    personality: { id: 'p-1', name: 'Testy' } as any,
    personaId: 'persona-1',
    userMessageContent: 'hello',
    userMessageTime: new Date('2026-05-15T10:00:00Z'),
    ...overrides,
  } as MessageJobContext;
}

describe('messageJobContextToSlotContext', () => {
  it('projects every field through unchanged', () => {
    const jobContext = buildJobContext({ isAutoResponse: true });

    const result = messageJobContextToSlotContext(jobContext);

    expect(result).toEqual({
      message: jobContext.message,
      channel: jobContext.channel,
      guildId: jobContext.guildId,
      clientId: jobContext.clientId,
      personality: jobContext.personality,
      personaId: jobContext.personaId,
      userMessageContent: jobContext.userMessageContent,
      userMessageTime: jobContext.userMessageTime,
      isAutoResponse: true,
      recipientUserId: 'author-1',
    });
  });

  it('defaults isAutoResponse to false when the source field is missing', () => {
    const jobContext = buildJobContext();
    delete (jobContext as { isAutoResponse?: boolean }).isAutoResponse;

    const result = messageJobContextToSlotContext(jobContext);

    expect(result.isAutoResponse).toBe(false);
  });

  it('falls back recipientUserId to empty string when the message has no author', () => {
    const jobContext = buildJobContext({
      message: {} as unknown as Message,
    });

    const result = messageJobContextToSlotContext(jobContext);

    expect(result.recipientUserId).toBe('');
  });
});
