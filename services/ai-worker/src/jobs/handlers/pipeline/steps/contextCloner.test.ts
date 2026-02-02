/**
 * Tests for Context Cloner Utility
 */

import { describe, it, expect } from 'vitest';
import { cloneContextForRetry } from './contextCloner.js';
import type { ConversationContext } from '../../../../services/ConversationalRAGService.js';

function createMockContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    userId: 'user-123',
    userName: 'Test User',
    channelId: 'channel-123',
    conversationHistory: [],
    rawConversationHistory: [],
    participants: [],
    ...overrides,
  };
}

describe('cloneContextForRetry', () => {
  it('should create a shallow clone of basic properties', () => {
    const original = createMockContext();
    const cloned = cloneContextForRetry(original);

    expect(cloned.userId).toBe(original.userId);
    expect(cloned.userName).toBe(original.userName);
    expect(cloned.channelId).toBe(original.channelId);
  });

  it('should create a new array for rawConversationHistory', () => {
    const original = createMockContext({
      rawConversationHistory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    });
    const cloned = cloneContextForRetry(original);

    expect(cloned.rawConversationHistory).not.toBe(original.rawConversationHistory);
    expect(cloned.rawConversationHistory).toHaveLength(2);
  });

  it('should deep clone messageMetadata', () => {
    const refMsg = {
      discordMessageId: 'msg-1',
      authorUsername: 'user1',
      authorDisplayName: 'User One',
      content: 'Referenced content',
      timestamp: '2024-01-01T00:00:00Z',
      locationContext: '#general',
    };
    const imgDesc = { filename: 'img.png', description: 'An image' };
    const reaction = { emoji: '👍', reactors: [{ personaId: 'p1', displayName: 'Persona' }] };

    const original = createMockContext({
      rawConversationHistory: [
        {
          role: 'user',
          content: 'Hello',
          messageMetadata: {
            referencedMessages: [refMsg],
            imageDescriptions: [imgDesc],
            reactions: [reaction],
          },
        },
      ],
    });
    const cloned = cloneContextForRetry(original);

    const originalMeta = original.rawConversationHistory![0].messageMetadata;
    const clonedMeta = cloned.rawConversationHistory![0].messageMetadata;

    // Arrays should be cloned, not the same reference
    expect(clonedMeta!.referencedMessages).not.toBe(originalMeta!.referencedMessages);
    expect(clonedMeta!.imageDescriptions).not.toBe(originalMeta!.imageDescriptions);
    expect(clonedMeta!.reactions).not.toBe(originalMeta!.reactions);

    // But values should be the same
    expect(clonedMeta!.referencedMessages).toEqual(originalMeta!.referencedMessages);
    expect(clonedMeta!.imageDescriptions).toEqual(originalMeta!.imageDescriptions);
    expect(clonedMeta!.reactions).toEqual(originalMeta!.reactions);
  });

  it('should handle undefined messageMetadata', () => {
    const original = createMockContext({
      rawConversationHistory: [{ role: 'user', content: 'Hello', messageMetadata: undefined }],
    });
    const cloned = cloneContextForRetry(original);

    expect(cloned.rawConversationHistory![0].messageMetadata).toBeUndefined();
  });

  it('should handle undefined rawConversationHistory', () => {
    const original = createMockContext({ rawConversationHistory: undefined });
    const cloned = cloneContextForRetry(original);

    expect(cloned.rawConversationHistory).toBeUndefined();
  });

  it('should handle empty rawConversationHistory', () => {
    const original = createMockContext({ rawConversationHistory: [] });
    const cloned = cloneContextForRetry(original);

    expect(cloned.rawConversationHistory).toEqual([]);
    expect(cloned.rawConversationHistory).not.toBe(original.rawConversationHistory);
  });

  it('should not mutate original when modifying clone', () => {
    const refMsg = {
      discordMessageId: 'msg-1',
      authorUsername: 'user1',
      authorDisplayName: 'User One',
      content: 'Referenced content',
      timestamp: '2024-01-01T00:00:00Z',
      locationContext: '#general',
    };
    const original = createMockContext({
      rawConversationHistory: [
        {
          role: 'user',
          content: 'Hello',
          messageMetadata: {
            referencedMessages: [refMsg],
          },
        },
      ],
    });
    const cloned = cloneContextForRetry(original);

    // Modify the cloned metadata by pushing a new reference
    const newRef = { ...refMsg, discordMessageId: 'msg-2' };
    cloned.rawConversationHistory![0].messageMetadata!.referencedMessages!.push(newRef);

    // Original should be unchanged (still only 1 item)
    expect(original.rawConversationHistory![0].messageMetadata!.referencedMessages).toHaveLength(1);
    expect(
      original.rawConversationHistory![0].messageMetadata!.referencedMessages![0].discordMessageId
    ).toBe('msg-1');
  });

  it('should handle messageMetadata with undefined nested arrays', () => {
    const original = createMockContext({
      rawConversationHistory: [
        {
          role: 'user',
          content: 'Hello',
          messageMetadata: {
            referencedMessages: undefined,
            imageDescriptions: undefined,
            reactions: undefined,
          },
        },
      ],
    });
    const cloned = cloneContextForRetry(original);

    const clonedMeta = cloned.rawConversationHistory![0].messageMetadata;
    expect(clonedMeta!.referencedMessages).toBeUndefined();
    expect(clonedMeta!.imageDescriptions).toBeUndefined();
    expect(clonedMeta!.reactions).toBeUndefined();
  });
});
