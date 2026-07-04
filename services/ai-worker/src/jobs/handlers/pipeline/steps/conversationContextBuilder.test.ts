/**
 * Tests for Conversation Context Builder
 */

import { describe, it, expect } from 'vitest';
import { buildConversationContext } from './conversationContextBuilder.js';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
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
          {
            id: 'msg-1',
            role: MessageRole.User,
            content: 'DM message',
            createdAt: '2026-02-26T10:00:00Z',
          },
        ],
      },
    ];

    const result = buildConversationContext(jobContext, prepared, undefined);

    expect(result.crossChannelHistory).toHaveLength(1);
    expect(result.crossChannelHistory?.[0].channelEnvironment.type).toBe('dm');
    expect(result.crossChannelHistory?.[0].messages[0].content).toBe('DM message');
  });

  // This is the single resolution boundary for the memory consumers: the wire
  // flags (incognito/isWeighIn) become a SummonAnonymity union exactly once here,
  // so MemoryRetriever/ConversationalRAGService can't re-derive it differently.
  describe('summonAnonymity resolution', () => {
    it('resolves a personal summon when no anonymity flags are set', () => {
      const jobContext = createMinimalJobContext();
      jobContext.activePersonaId = 'persona-1';
      jobContext.activePersonaName = 'Vee';

      const result = buildConversationContext(
        jobContext,
        createMinimalPreparedContext(),
        undefined
      );

      expect(result.summonAnonymity).toEqual({
        kind: 'personal',
        activePersonaId: 'persona-1',
        activePersonaName: 'Vee',
      });
    });

    it('defaults to incognito when isWeighIn is set and incognito is unset', () => {
      const jobContext = createMinimalJobContext();
      jobContext.isWeighIn = true;

      const result = buildConversationContext(
        jobContext,
        createMinimalPreparedContext(),
        undefined
      );

      expect(result.summonAnonymity).toEqual({ kind: 'incognito' });
    });

    it('resolves personal when incognito=false overrides weigh-in framing', () => {
      const jobContext = createMinimalJobContext();
      jobContext.isWeighIn = true;
      jobContext.incognito = false;
      jobContext.activePersonaId = 'persona-1';
      jobContext.activePersonaName = 'Vee';

      const result = buildConversationContext(
        jobContext,
        createMinimalPreparedContext(),
        undefined
      );

      expect(result.summonAnonymity).toEqual({
        kind: 'personal',
        activePersonaId: 'persona-1',
        activePersonaName: 'Vee',
      });
    });

    it('resolves incognito when incognito=true regardless of persona fields on the wire', () => {
      const jobContext = createMinimalJobContext();
      jobContext.incognito = true;
      jobContext.activePersonaId = 'persona-1';

      const result = buildConversationContext(
        jobContext,
        createMinimalPreparedContext(),
        undefined
      );

      expect(result.summonAnonymity).toEqual({ kind: 'incognito' });
    });
  });
});
