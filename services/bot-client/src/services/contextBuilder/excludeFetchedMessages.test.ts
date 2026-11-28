import { describe, it, expect } from 'vitest';
import type { ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import type { FetchResult } from '../channelFetcher/types.js';
import { excludeFetchedMessages } from './excludeFetchedMessages.js';

function message(discordMessageId: string[]): ConversationMessage {
  return {
    id: `row-${discordMessageId.join('-')}`,
    role: 'assistant',
    content: 'text',
    createdAt: '2026-01-01T00:00:00.000Z',
    discordMessageId,
  } as unknown as ConversationMessage;
}

function fetchResult(messages: ConversationMessage[]): FetchResult {
  return { messages, fetchedCount: messages.length, keptCount: messages.length };
}

describe('excludeFetchedMessages', () => {
  it('drops a message in the middle of the set, matching on any of its chunk ids', () => {
    const newest = message(['m3']);
    const oldReply = message(['m2a', 'm2b']);
    const oldest = message(['m1']);

    const result = excludeFetchedMessages(fetchResult([newest, oldReply, oldest]), ['m2b']);

    expect(result.messages).toEqual([newest, oldest]);
    expect(result.keptCount).toBe(2);
  });

  it('returns the same object when nothing matches', () => {
    const input = fetchResult([message(['m1'])]);
    expect(excludeFetchedMessages(input, ['other'])).toBe(input);
  });

  it('returns the same object when no exclusions are given', () => {
    const input = fetchResult([message(['m1'])]);
    expect(excludeFetchedMessages(input, undefined)).toBe(input);
    expect(excludeFetchedMessages(input, [])).toBe(input);
  });
});
