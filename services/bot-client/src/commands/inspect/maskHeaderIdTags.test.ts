import { describe, it, expect, vi } from 'vitest';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import {
  maskHeaderIdTags,
  maskPayloadHeaderIdTags,
  payloadForViewer,
  payloadForUser,
} from './maskHeaderIdTags.js';
import type { ViewContext } from './viewContext.js';

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return { ...actual, isBotOwner: (id: string) => id === 'owner-123' };
});

function createMockPayload(overrides?: Partial<DiagnosticPayload>): DiagnosticPayload {
  return {
    meta: {
      requestId: 'test-req-123',
      personalityId: 'personality-uuid',
      personalityName: 'Test Personality',
      userId: '123456789',
      guildId: '987654321',
      channelId: '111222333',
      timestamp: '2026-01-22T12:00:00Z',
    },
    inputProcessing: {
      rawUserMessage: 'Hello',
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: 'hello',
    },
    memoryRetrieval: {
      memoriesFound: [],
      freshModeEnabled: false,
    },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 4000,
      memoryTokensUsed: 1000,
      historyTokensUsed: 92000,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    },
    assembledPrompt: {
      messages: [
        { role: 'system', content: '<persona>You are helpful.</persona>' },
        { role: 'user', content: '[Vlad (id:abcd) — 12:00] Hello, how are you?' },
        { role: 'assistant', content: 'I am well, thank you!' },
      ],
      totalTokenEstimate: 100,
    },
    llmConfig: {
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      temperature: 0.8,
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hi there!',
      finishReason: 'stop',
      promptTokens: 50,
      completionTokens: 10,
      modelUsed: 'claude-3-5-sonnet-20241022',
    },
    postProcessing: {
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: 'Hi there!',
    },
    timing: {
      totalDurationMs: 1500,
      memoryRetrievalMs: 50,
      llmInvocationMs: 1400,
    },
    ...overrides,
  };
}

describe('maskHeaderIdTags', () => {
  it('masks a 4-char tag inside a realistic header', () => {
    const result = maskHeaderIdTags('[Vlad (id:abcd) — 12:00]');
    expect(result).toContain('(id:····)');
    expect(result).not.toContain('abcd');
  });

  it('masks an 8-char tag', () => {
    const result = maskHeaderIdTags('[Vlad (id:abcdef12) — 12:00]');
    expect(result).toContain('(id:····)');
    expect(result).not.toContain('abcdef12');
  });

  it('masks a 32-char tag', () => {
    const hex32 = 'abcdef0123456789abcdef0123456789';
    const result = maskHeaderIdTags(`[Vlad (id:${hex32}) — 12:00]`);
    expect(result).toContain('(id:····)');
    expect(result).not.toContain(hex32);
  });

  it('masks several tags in one string', () => {
    const result = maskHeaderIdTags('[Vlad (id:abcd)] said hi to [Sam (id:ef01)]');
    expect(result).not.toContain('abcd');
    expect(result).not.toContain('ef01');
    expect(result.match(/\(id:····\)/g)).toHaveLength(2);
  });

  it('masks uppercase hex', () => {
    const result = maskHeaderIdTags('[Vlad (id:ABCD) — 12:00]');
    expect(result).toContain('(id:····)');
    expect(result).not.toContain('ABCD');
  });

  it('leaves a non-hex near-miss identical', () => {
    const input = '(id:xyz)';
    expect(maskHeaderIdTags(input)).toBe(input);
  });

  it('leaves an "identity:" near-miss identical', () => {
    const input = '(identity:abcd)';
    expect(maskHeaderIdTags(input)).toBe(input);
  });

  it('leaves a 5-hex-char near-miss identical (width bounding)', () => {
    const input = '(id:abcde)';
    expect(maskHeaderIdTags(input)).toBe(input);
  });

  it('leaves text with no tag identical', () => {
    const input = 'just a plain message with no tag at all';
    expect(maskHeaderIdTags(input)).toBe(input);
  });
});

describe('maskPayloadHeaderIdTags', () => {
  it('masks a tag carried in assembledPrompt.messages content', () => {
    const payload = createMockPayload();
    const result = maskPayloadHeaderIdTags(payload);
    const userMsg = result.assembledPrompt.messages.find(m => m.role === 'user');
    expect(userMsg?.content).not.toContain('abcd');
    expect(userMsg?.content).toContain('(id:····)');
  });

  it('leaves numbers, booleans, null, nested arrays, and undefined values unchanged', () => {
    const payload = createMockPayload({
      tokenBudget: {
        contextWindowSize: 128000,
        systemPromptTokens: 4000,
        memoryTokensUsed: 1000,
        historyTokensUsed: 92000,
        memoriesDropped: 0,
        historyMessagesDropped: 0,
        crossChannelMessagesIncluded: undefined,
      },
      inputProcessing: {
        rawUserMessage: 'Hello',
        attachmentDescriptions: [],
        voiceTranscript: null,
        referencedMessageIds: ['a', 'b'],
        referencedMessagesContent: [],
        searchQuery: null,
      },
      postProcessing: {
        transformsApplied: [],
        duplicateDetected: false,
        thinkingExtracted: false,
        thinkingContent: null,
        artifactsStripped: [],
        finalContent: 'Hi there!',
      },
    });
    const result = maskPayloadHeaderIdTags(payload);
    expect(result.tokenBudget.contextWindowSize).toBe(128000);
    expect(result.tokenBudget.memoriesDropped).toBe(0);
    expect(result.tokenBudget.crossChannelMessagesIncluded).toBeUndefined();
    expect(result.postProcessing.duplicateDetected).toBe(false);
    expect(result.inputProcessing.voiceTranscript).toBeNull();
    expect(result.inputProcessing.searchQuery).toBeNull();
    expect(result.inputProcessing.referencedMessageIds).toEqual(['a', 'b']);
  });
});

describe('payloadForViewer', () => {
  it('returns the payload byte-exact for a bot owner, even when canViewCharacter is true', () => {
    const payload = createMockPayload();
    const ctx: ViewContext = { canViewCharacter: true, isBotOwner: true };
    const result = payloadForViewer(payload, ctx);
    const userMsg = result.assembledPrompt.messages.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('abcd');
  });

  it('masks the payload for a non-bot-owner', () => {
    const payload = createMockPayload();
    const ctx: ViewContext = { canViewCharacter: false, isBotOwner: false };
    const result = payloadForViewer(payload, ctx);
    const userMsg = result.assembledPrompt.messages.find(m => m.role === 'user');
    expect(userMsg?.content).not.toContain('abcd');
    expect(userMsg?.content).toContain('(id:····)');
  });

  it('masks the payload for a character owner who is not the bot owner', () => {
    const payload = createMockPayload();
    const ctx: ViewContext = { canViewCharacter: true, isBotOwner: false };
    const result = payloadForViewer(payload, ctx);
    const userMsg = result.assembledPrompt.messages.find(m => m.role === 'user');
    expect(userMsg?.content).not.toContain('abcd');
  });
});

describe('payloadForUser', () => {
  function createTaggedPayload(): DiagnosticPayload {
    return createMockPayload({
      error: {
        message: 'upstream call failed for [Vlad (id:abcd1234)]',
        category: ApiErrorCategory.UNKNOWN,
        failedAtStage: 'llmInvocation',
      },
      llmResponse: {
        rawContent: 'Hi there!',
        finishReason: '[Vlad (id:abcd1234)] stop',
        promptTokens: 50,
        completionTokens: 10,
        modelUsed: 'claude-3-5-sonnet-20241022',
      },
    });
  }

  it('masks the payload for a non-owner user id', () => {
    const payload = createTaggedPayload();
    const result = payloadForUser(payload, 'regular-user-456');
    expect(result.error?.message).toContain('(id:····)');
    expect(result.error?.message).not.toContain('abcd1234');
    expect(result.llmResponse.finishReason).toContain('(id:····)');
    expect(result.llmResponse.finishReason).not.toContain('abcd1234');
  });

  it('returns the same payload reference for the bot-owner user id', () => {
    const payload = createTaggedPayload();
    expect(payloadForUser(payload, 'owner-123')).toBe(payload);
  });
});
