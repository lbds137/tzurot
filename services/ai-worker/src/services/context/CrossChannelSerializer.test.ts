/**
 * Tests for CrossChannelSerializer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serializeCrossChannelHistory } from './CrossChannelSerializer.js';
import { MessageRole, type CrossChannelHistoryGroupEntry } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

function createGroup(
  overrides: Partial<CrossChannelHistoryGroupEntry> = {}
): CrossChannelHistoryGroupEntry {
  return {
    channelEnvironment: {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Test Server' },
      channel: { id: 'channel-1', name: 'general', type: 'text' },
    },
    messages: [
      {
        id: 'msg-1',
        role: MessageRole.User,
        content: 'Hello from another channel',
        createdAt: '2026-02-26T10:00:00Z',
        personaName: 'TestUser',
        tokenCount: 10,
      },
      {
        id: 'msg-2',
        role: MessageRole.Assistant,
        content: 'Hi there!',
        createdAt: '2026-02-26T10:01:00Z',
        tokenCount: 5,
      },
    ],
    ...overrides,
  };
}

describe('serializeCrossChannelHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty for empty groups', () => {
    const result = serializeCrossChannelHistory([], 'TestAI', 1000);
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should return empty when budget is 0', () => {
    const result = serializeCrossChannelHistory([createGroup()], 'TestAI', 0);
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should serialize a single group with location block', () => {
    const result = serializeCrossChannelHistory([createGroup()], 'TestAI', 5000);
    expect(result.xml).toContain('<prior_conversations>');
    expect(result.xml).toContain('</prior_conversations>');
    expect(result.xml).toContain('<channel_history>');
    expect(result.xml).toContain('</channel_history>');
    expect(result.xml).toContain('<location type="guild">');
    expect(result.xml).toContain('<server name="Test Server"/>');
    expect(result.xml).toContain('<channel name="general" type="text"/>');
    expect(result.xml).toContain('Hello from another channel');
    expect(result.messagesIncluded).toBe(2);
  });

  it('should serialize DM groups correctly', () => {
    const dmGroup = createGroup({
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'dm' },
      },
    });

    const result = serializeCrossChannelHistory([dmGroup], 'TestAI', 5000);
    expect(result.xml).toContain('<location type="dm">');
    expect(result.xml).toContain('Direct Message');
  });

  it('should use recency strategy: keep newest messages when budget is tight', () => {
    const group = createGroup({
      messages: [
        { id: 'msg-1', role: MessageRole.User, content: 'Oldest message', tokenCount: 50 },
        { id: 'msg-2', role: MessageRole.Assistant, content: 'Second message', tokenCount: 50 },
        { id: 'msg-3', role: MessageRole.User, content: 'Third message', tokenCount: 50 },
        { id: 'msg-4', role: MessageRole.Assistant, content: 'Newest message', tokenCount: 50 },
      ],
    });

    // Budget fits ~2 messages plus overhead, not all 4
    const result = serializeCrossChannelHistory([group], 'TestAI', 150);
    // Recency: should keep newest (msg-4, msg-3), drop oldest (msg-1, msg-2)
    expect(result.xml).toContain('Newest message');
    expect(result.xml).toContain('Third message');
    expect(result.xml).not.toContain('Oldest message');
    expect(result.xml).not.toContain('Second message');
    expect(result.messagesIncluded).toBe(2);
  });

  it('should skip entire group when newest message exceeds budget (contiguous tail)', () => {
    const group = createGroup({
      messages: [
        { id: 'msg-1', role: MessageRole.User, content: 'Short', tokenCount: 5 },
        { id: 'msg-2', role: MessageRole.Assistant, content: 'Also short', tokenCount: 5 },
        {
          id: 'msg-3',
          role: MessageRole.User,
          content: 'This is a very long message '.repeat(50),
          tokenCount: 500,
        },
      ],
    });

    // Budget can't fit msg-3 (newest), so contiguous-tail strategy skips entire group
    const result = serializeCrossChannelHistory([group], 'TestAI', 200);
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should return empty when budget is too tight for any messages', () => {
    const group = createGroup({
      messages: [{ id: 'msg-1', role: MessageRole.User, content: 'Hello world', tokenCount: 100 }],
    });

    // Budget of 5 is too small for even the wrapper overhead + location block + one message
    const result = serializeCrossChannelHistory([group], 'TestAI', 5);
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should serialize multiple groups', () => {
    const group1 = createGroup();
    const group2 = createGroup({
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-2', name: 'random', type: 'text' },
      },
      messages: [
        {
          id: 'msg-3',
          role: MessageRole.User,
          content: 'In the random channel',
          tokenCount: 8,
        },
      ],
    });

    const result = serializeCrossChannelHistory([group1, group2], 'TestAI', 5000);
    expect(result.xml).toContain('general');
    expect(result.xml).toContain('random');
    expect(result.xml).toContain('In the random channel');
    expect(result.messagesIncluded).toBe(3);
  });
});
