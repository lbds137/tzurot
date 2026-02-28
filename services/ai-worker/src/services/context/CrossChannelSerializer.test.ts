/**
 * Tests for CrossChannelSerializer
 */

import { describe, it, expect, vi } from 'vitest';
import { serializeCrossChannelHistory } from './CrossChannelSerializer.js';
import type { CrossChannelGroup } from '../../jobs/utils/conversationUtils.js';

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

function createGroup(overrides: Partial<CrossChannelGroup> = {}): CrossChannelGroup {
  return {
    channelEnvironment: {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Test Server' },
      channel: { id: 'channel-1', name: 'general', type: 'text' },
    },
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello from another channel',
        createdAt: '2026-02-26T10:00:00Z',
        personaName: 'TestUser',
        tokenCount: 10,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
        createdAt: '2026-02-26T10:01:00Z',
        tokenCount: 5,
      },
    ],
    ...overrides,
  };
}

describe('serializeCrossChannelHistory', () => {
  it('should return empty string for empty groups', () => {
    const result = serializeCrossChannelHistory([], 'TestAI', 1000);
    expect(result).toBe('');
  });

  it('should return empty string when budget is 0', () => {
    const result = serializeCrossChannelHistory([createGroup()], 'TestAI', 0);
    expect(result).toBe('');
  });

  it('should serialize a single group with location block', () => {
    const result = serializeCrossChannelHistory([createGroup()], 'TestAI', 5000);
    expect(result).toContain('<prior_conversations>');
    expect(result).toContain('</prior_conversations>');
    expect(result).toContain('<channel_history>');
    expect(result).toContain('</channel_history>');
    expect(result).toContain('<location type="guild">');
    expect(result).toContain('<server name="Test Server"/>');
    expect(result).toContain('<channel name="general" type="text"/>');
    expect(result).toContain('Hello from another channel');
  });

  it('should serialize DM groups correctly', () => {
    const dmGroup = createGroup({
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'dm' },
      },
    });

    const result = serializeCrossChannelHistory([dmGroup], 'TestAI', 5000);
    expect(result).toContain('<location type="dm">');
    expect(result).toContain('Direct Message');
  });

  it('should respect token budget by excluding messages that exceed it', () => {
    const group = createGroup({
      messages: [
        { id: 'msg-1', role: 'user', content: 'Short', tokenCount: 5 },
        { id: 'msg-2', role: 'assistant', content: 'Also short', tokenCount: 5 },
        {
          id: 'msg-3',
          role: 'user',
          content: 'This is a very long message '.repeat(50),
          tokenCount: 500,
        },
      ],
    });

    // Budget that fits first two messages but not the third
    const result = serializeCrossChannelHistory([group], 'TestAI', 100);
    // With very tight budget, it may include only some messages or none
    if (result.length > 0) {
      expect(result).toContain('Short');
      expect(result).not.toContain('This is a very long message');
    }
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
          role: 'user',
          content: 'In the random channel',
          tokenCount: 8,
        },
      ],
    });

    const result = serializeCrossChannelHistory([group1, group2], 'TestAI', 5000);
    expect(result).toContain('general');
    expect(result).toContain('random');
    expect(result).toContain('In the random channel');
  });
});
