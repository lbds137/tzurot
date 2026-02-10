import { describe, it, expect } from 'vitest';
import { getEmbedColor, buildReasoningField, buildDiagnosticEmbed } from './embed.js';
import type { DiagnosticPayload } from '@tzurot/common-types';

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
      memoriesFound: [
        { id: 'mem-1', score: 0.95, preview: 'Memory preview...', includedInPrompt: true },
      ],
      focusModeEnabled: false,
    },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 500,
      memoryTokensUsed: 1000,
      historyTokensUsed: 2000,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    },
    assembledPrompt: {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      totalTokenEstimate: 100,
    },
    llmConfig: {
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      temperature: 0.8,
      stopSequences: [],
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hi there!',
      finishReason: 'stop',
      stopSequenceTriggered: null,
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

describe('getEmbedColor', () => {
  it('should return red for errors', () => {
    const payload = createMockPayload({
      error: { message: 'fail', category: 'API', failedAtStage: 'llm' },
    });
    expect(getEmbedColor(payload)).toBe(0xff0000);
  });

  it('should return orange for length finish reason', () => {
    const payload = createMockPayload();
    payload.llmResponse.finishReason = 'length';
    expect(getEmbedColor(payload)).toBe(0xff6600);
  });

  it('should return green for success', () => {
    const payload = createMockPayload();
    expect(getEmbedColor(payload)).toBe(0x00ff00);
  });
});

describe('buildReasoningField', () => {
  it('should return null when no reasoning config', () => {
    const payload = createMockPayload();
    expect(buildReasoningField(payload)).toBeNull();
  });

  it('should include reasoning config details', () => {
    const payload = createMockPayload();
    payload.llmConfig.allParams = {
      reasoning: { effort: 'medium', enabled: true },
    };
    payload.llmResponse.reasoningDebug = {
      additionalKwargsKeys: [],
      hasReasoningInKwargs: false,
      reasoningKwargsLength: 0,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: true,
      rawContentPreview: '<reasoning>thinking...</reasoning>Response',
    };
    payload.postProcessing.thinkingContent = 'thinking...';

    const field = buildReasoningField(payload);
    expect(field).not.toBeNull();
    expect(field!.value).toContain('effort=medium');
    expect(field!.value).toContain('found');
    expect(field!.value).toContain('Yes (11 chars)');
  });

  it('should show LOW warning for low completion tokens', () => {
    const payload = createMockPayload();
    payload.llmConfig.allParams = { reasoning: { effort: 'high', enabled: true } };
    payload.llmResponse.completionTokens = 35;

    const field = buildReasoningField(payload);
    expect(field).not.toBeNull();
    expect(field!.value).toContain('LOW');
  });
});

describe('buildDiagnosticEmbed', () => {
  it('should build an embed with request, model, and memory fields', () => {
    const payload = createMockPayload();
    const embed = buildDiagnosticEmbed(payload);
    const data = embed.toJSON();

    expect(data.title).toContain('Diagnostic Summary');
    expect(data.fields).toBeDefined();
    expect(data.fields!.length).toBeGreaterThanOrEqual(5);
  });

  it('should show FAILED title for error payloads', () => {
    const payload = createMockPayload({
      error: { message: 'timeout', category: 'API', failedAtStage: 'llm' },
    });
    const embed = buildDiagnosticEmbed(payload);
    expect(embed.toJSON().title).toContain('FAILED');
  });

  it('should include sycophancy warning when history > 70%', () => {
    const payload = createMockPayload();
    payload.tokenBudget.contextWindowSize = 10000;
    payload.tokenBudget.historyTokensUsed = 8000;

    const embed = buildDiagnosticEmbed(payload);
    const fields = embed.toJSON().fields ?? [];
    const tokenField = fields.find(f => f.name.includes('Token Budget'));
    expect(tokenField?.value).toContain('Sycophancy risk');
  });

  it('should set footer to interactive hint', () => {
    const payload = createMockPayload();
    const embed = buildDiagnosticEmbed(payload);
    expect(embed.toJSON().footer?.text).toContain('buttons and menu');
  });

  it('should include reasoning field when reasoning config present', () => {
    const payload = createMockPayload();
    payload.llmConfig.allParams = { reasoning: { effort: 'high', enabled: true } };

    const embed = buildDiagnosticEmbed(payload);
    const fields = embed.toJSON().fields ?? [];
    const reasoningField = fields.find(f => f.name.includes('Reasoning'));
    expect(reasoningField).toBeDefined();
  });
});
