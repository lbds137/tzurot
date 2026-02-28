/**
 * Tests for Conversation Context Builder
 */

import { describe, it, expect } from 'vitest';
import { buildConversationContext } from './conversationContextBuilder.js';
import { AttachmentType, type LLMGenerationJobData } from '@tzurot/common-types';
import type { PreparedContext, PreprocessingResults } from '../types.js';

function createMinimalJobContext(): LLMGenerationJobData['context'] {
  return {
    userId: 'user-123',
    userName: 'TestUser',
    channelId: 'channel-456',
  };
}

function createMinimalPreparedContext(): PreparedContext {
  return {
    conversationHistory: [],
    rawConversationHistory: [],
    participants: [],
  };
}

describe('buildConversationContext', () => {
  it('should map job context and prepared context to ConversationContext', () => {
    const jobContext = createMinimalJobContext();
    const prepared = createMinimalPreparedContext();

    const result = buildConversationContext(jobContext, prepared, undefined);

    expect(result.userId).toBe('user-123');
    expect(result.userName).toBe('TestUser');
    expect(result.channelId).toBe('channel-456');
    expect(result.conversationHistory).toEqual([]);
    expect(result.preprocessedAttachments).toBeUndefined();
  });

  it('should include preprocessed attachments when present', () => {
    const jobContext = createMinimalJobContext();
    const prepared = createMinimalPreparedContext();
    const preprocessing: PreprocessingResults = {
      processedAttachments: [
        {
          type: AttachmentType.Image,
          description: 'A sunset',
          originalUrl: 'https://example.com/image.png',
          metadata: { url: 'https://example.com/image.png', contentType: 'image/png' },
        },
      ],
      transcriptions: [],
      referenceAttachments: {},
    };

    const result = buildConversationContext(jobContext, prepared, preprocessing);

    expect(result.preprocessedAttachments).toHaveLength(1);
    expect(result.preprocessedAttachments?.[0].description).toBe('A sunset');
  });

  it('should omit preprocessed attachments when array is empty', () => {
    const jobContext = createMinimalJobContext();
    const prepared = createMinimalPreparedContext();
    const preprocessing: PreprocessingResults = {
      processedAttachments: [],
      transcriptions: [],
      referenceAttachments: {},
    };

    const result = buildConversationContext(jobContext, prepared, preprocessing);

    expect(result.preprocessedAttachments).toBeUndefined();
  });

  it('should pass guild info through', () => {
    const jobContext = createMinimalJobContext();
    jobContext.activePersonaGuildInfo = {
      roles: ['Admin'],
      displayColor: '#FF0000',
    };
    const prepared = createMinimalPreparedContext();

    const result = buildConversationContext(jobContext, prepared, undefined);

    expect(result.activePersonaGuildInfo).toEqual({
      roles: ['Admin'],
      displayColor: '#FF0000',
    });
  });

  it('should map cross-channel history from prepared context', () => {
    const jobContext = createMinimalJobContext();
    const prepared = createMinimalPreparedContext();
    prepared.crossChannelHistory = [
      {
        channelEnvironment: {
          type: 'dm' as const,
          channel: { id: 'dm-1', name: 'DM', type: 'dm' },
        },
        messages: [
          { id: 'msg-1', role: 'user', content: 'DM message', createdAt: '2026-02-26T10:00:00Z' },
        ],
      },
    ];

    const result = buildConversationContext(jobContext, prepared, undefined);

    expect(result.crossChannelHistory).toHaveLength(1);
    expect(result.crossChannelHistory?.[0].channelEnvironment.type).toBe('dm');
    expect(result.crossChannelHistory?.[0].messages[0].content).toBe('DM message');
  });
});
