import { describe, it, expect } from 'vitest';
import { DISCORD_COLORS } from '@tzurot/common-types';
import type { DiagnosticPayload } from '@tzurot/common-types';
import {
  getEmbedColor,
  buildReasoningField,
  buildDiagnosticEmbed,
  formatFinishReason,
  formatExtractionStatus,
  formatMemoryFoundLine,
} from './embed.js';

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
  it('should return ERROR color for errors', () => {
    const payload = createMockPayload({
      error: { message: 'fail', category: 'API', failedAtStage: 'llm' },
    });
    expect(getEmbedColor(payload)).toBe(DISCORD_COLORS.ERROR);
  });

  it('should return WARNING color for length finish reason', () => {
    const payload = createMockPayload();
    payload.llmResponse.finishReason = 'length';
    expect(getEmbedColor(payload)).toBe(DISCORD_COLORS.WARNING);
  });

  it('should return SUCCESS color for success', () => {
    const payload = createMockPayload();
    expect(getEmbedColor(payload)).toBe(DISCORD_COLORS.SUCCESS);
  });
});

describe('formatFinishReason', () => {
  it('decorates natural-completion finish reasons with ✅', () => {
    expect(formatFinishReason('stop')).toBe('stop ✅');
    expect(formatFinishReason('end_turn')).toBe('end_turn ✅');
    expect(formatFinishReason('STOP')).toBe('STOP ✅');
    expect(formatFinishReason('stop_sequence')).toBe('stop_sequence ✅');
  });

  it('decorates length truncation with ⚠️', () => {
    expect(formatFinishReason('length')).toBe('length ⚠️');
  });

  it('decorates content_filter with ⛔', () => {
    expect(formatFinishReason('content_filter')).toBe('content_filter ⛔');
  });

  it('decorates unknown sentinel with ❔', () => {
    expect(formatFinishReason('unknown')).toBe('unknown ❔');
  });

  it('passes through unrecognized reasons unchanged', () => {
    expect(formatFinishReason('weird_provider_specific_reason')).toBe(
      'weird_provider_specific_reason'
    );
  });
});

describe('formatExtractionStatus', () => {
  it('returns null when reasoningDebug is undefined (pre-PR-#895 logs)', () => {
    expect(formatExtractionStatus(undefined)).toBeNull();
  });

  it('returns null when apiReasoningLength is undefined (legacy reasoningDebug shape)', () => {
    expect(
      formatExtractionStatus({
        additionalKwargsKeys: [],
        hasReasoningInKwargs: false,
        reasoningKwargsLength: 0,
        responseMetadataKeys: [],
        hasReasoningDetails: false,
        hasReasoningTagsInContent: false,
        rawContentPreview: '',
      })
    ).toBeNull();
  });

  it('shows healthy extraction when API and pipeline lengths match', () => {
    const result = formatExtractionStatus({
      additionalKwargsKeys: ['reasoning'],
      hasReasoningInKwargs: true,
      reasoningKwargsLength: 1063,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
      apiReasoningLength: 1063,
    });
    expect(result).toContain('✅');
    expect(result).toContain('1,063');
    expect(result).toContain('1,063 chars (extracted)');
  });

  it('shows ❌ LEAK when API has reasoning but pipeline shows zero', () => {
    const result = formatExtractionStatus({
      additionalKwargsKeys: [],
      hasReasoningInKwargs: false,
      reasoningKwargsLength: 0,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
      apiReasoningLength: 1063,
    });
    expect(result).toContain('❌');
    expect(result).toContain('LEAK');
  });

  it('shows ⚠️ "no structured reasoning" when both API and pipeline are zero', () => {
    const result = formatExtractionStatus({
      additionalKwargsKeys: [],
      hasReasoningInKwargs: false,
      reasoningKwargsLength: 0,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
      apiReasoningLength: 0,
    });
    expect(result).toContain('⚠️');
    expect(result).toContain('no structured reasoning');
  });

  it('shows ⚠️ partial when API and pipeline lengths differ but both are non-zero', () => {
    const result = formatExtractionStatus({
      additionalKwargsKeys: ['reasoning'],
      hasReasoningInKwargs: true,
      reasoningKwargsLength: 500,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
      apiReasoningLength: 1063,
    });
    expect(result).toContain('⚠️');
    expect(result).toContain('500');
    expect(result).toContain('1,063');
  });
});

describe('formatMemoryFoundLine', () => {
  it('returns Found: 0 for empty memories', () => {
    expect(formatMemoryFoundLine([])).toBe('**Found:** 0');
  });

  it('shows score range when memories exist', () => {
    const memories = [
      { id: 'a', score: 0.55, preview: 'p', includedInPrompt: true },
      { id: 'b', score: 0.84, preview: 'p', includedInPrompt: true },
      { id: 'c', score: 0.71, preview: 'p', includedInPrompt: false },
    ];
    expect(formatMemoryFoundLine(memories)).toBe('**Found:** 3 (scores 0.55–0.84)');
  });

  it('shows identical min and max when only one memory', () => {
    const memories = [{ id: 'a', score: 0.7, preview: 'p', includedInPrompt: true }];
    expect(formatMemoryFoundLine(memories)).toBe('**Found:** 1 (scores 0.70–0.70)');
  });
});

describe('buildReasoningField', () => {
  it('should return null when no reasoning config', () => {
    const payload = createMockPayload();
    expect(buildReasoningField(payload)).toBeNull();
  });

  it('shows config + upstream + extraction lines when reasoningDebug is populated', () => {
    const payload = createMockPayload();
    payload.llmConfig.allParams = {
      reasoning: { effort: 'medium', enabled: true },
    };
    payload.llmResponse.reasoningDebug = {
      additionalKwargsKeys: ['reasoning'],
      hasReasoningInKwargs: true,
      reasoningKwargsLength: 1063,
      responseMetadataKeys: ['openrouter'],
      hasReasoningDetails: true,
      hasReasoningTagsInContent: false,
      rawContentPreview: 'response',
      apiReasoningLength: 1063,
      upstreamProvider: 'DekaLLM',
      apiMessageKeys: ['role', 'content', 'reasoning'],
    };

    const field = buildReasoningField(payload);
    expect(field).not.toBeNull();
    expect(field!.value).toContain('effort=medium');
    expect(field!.value).toContain('Upstream:** DekaLLM');
    expect(field!.value).toContain('Extraction:');
    expect(field!.value).toContain('1,063 chars');
  });

  it('does NOT include the legacy "Interception" line that read hasReasoningTagsInContent', () => {
    // Regression guard: post-PR-#895 hasReasoningTagsInContent is always false
    // (the success path no longer injects tags into content), so the line was
    // misleading users with a permanent ❌. Confirm it's gone.
    const payload = createMockPayload();
    payload.llmConfig.allParams = { reasoning: { effort: 'medium', enabled: true } };
    payload.llmResponse.reasoningDebug = {
      additionalKwargsKeys: [],
      hasReasoningInKwargs: false,
      reasoningKwargsLength: 0,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
    };

    const field = buildReasoningField(payload);
    expect(field).not.toBeNull();
    expect(field!.value).not.toContain('Interception');
    expect(field!.value).not.toContain('not found');
    expect(field!.value).not.toContain('tags');
  });

  it('omits Upstream line when upstreamProvider is undefined (pre-PR-#895 logs)', () => {
    const payload = createMockPayload();
    payload.llmConfig.allParams = { reasoning: { effort: 'high', enabled: true } };
    payload.llmResponse.reasoningDebug = {
      additionalKwargsKeys: [],
      hasReasoningInKwargs: false,
      reasoningKwargsLength: 0,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
      // No upstreamProvider, no apiReasoningLength
    };

    const field = buildReasoningField(payload);
    expect(field!.value).not.toContain('Upstream:');
    expect(field!.value).not.toContain('Extraction:');
  });

  it('does NOT show LOW completion-tokens warning in the Reasoning field (moved to Response field)', () => {
    const payload = createMockPayload();
    payload.llmConfig.allParams = { reasoning: { effort: 'high', enabled: true } };
    payload.llmResponse.completionTokens = 35;

    const field = buildReasoningField(payload);
    expect(field).not.toBeNull();
    expect(field!.value).not.toContain('LOW');
    expect(field!.value).not.toContain('Completion Tokens');
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

  it('relabels Provider to Family and surfaces Upstream when reasoningDebug.upstreamProvider exists', () => {
    const payload = createMockPayload();
    payload.llmConfig.provider = 'z-ai';
    payload.llmResponse.reasoningDebug = {
      additionalKwargsKeys: [],
      hasReasoningInKwargs: false,
      reasoningKwargsLength: 0,
      responseMetadataKeys: [],
      hasReasoningDetails: false,
      hasReasoningTagsInContent: false,
      rawContentPreview: '',
      upstreamProvider: 'DekaLLM',
    };

    const embed = buildDiagnosticEmbed(payload);
    const modelField = embed.toJSON().fields?.find(f => f.name.includes('Model'));
    expect(modelField?.value).toContain('Family:** z-ai');
    expect(modelField?.value).toContain('Upstream:** DekaLLM');
    expect(modelField?.value).not.toContain('Provider:** z-ai');
  });

  it('shows finish reason with emoji decoration in Response field', () => {
    const payload = createMockPayload();
    payload.llmResponse.finishReason = 'length';

    const embed = buildDiagnosticEmbed(payload);
    const responseField = embed.toJSON().fields?.find(f => f.name.includes('Response'));
    expect(responseField?.value).toContain('length ⚠️');
  });

  it('shows LOW warning on Completion Tokens line when low + non-zero', () => {
    const payload = createMockPayload();
    payload.llmResponse.completionTokens = 47;

    const embed = buildDiagnosticEmbed(payload);
    const responseField = embed.toJSON().fields?.find(f => f.name.includes('Response'));
    expect(responseField?.value).toContain('Completion Tokens:** 47 ⚠️ LOW');
  });

  it('shows — for stop sequence when none triggered (instead of hiding the line)', () => {
    const payload = createMockPayload();
    payload.llmResponse.stopSequenceTriggered = null;

    const embed = buildDiagnosticEmbed(payload);
    const responseField = embed.toJSON().fields?.find(f => f.name.includes('Response'));
    expect(responseField?.value).toContain('Stop Sequence:** —');
  });

  it('shows the actual stop sequence in code formatting when one triggered', () => {
    const payload = createMockPayload();
    payload.llmResponse.stopSequenceTriggered = '</message>';

    const embed = buildDiagnosticEmbed(payload);
    const responseField = embed.toJSON().fields?.find(f => f.name.includes('Response'));
    expect(responseField?.value).toContain('Stop Sequence:** `</message>`');
  });

  it('shows memory score range in Memory field when memories exist', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [
      { id: 'a', score: 0.55, preview: 'p', includedInPrompt: true },
      { id: 'b', score: 0.84, preview: 'p', includedInPrompt: true },
    ];

    const embed = buildDiagnosticEmbed(payload);
    const memoryField = embed.toJSON().fields?.find(f => f.name.includes('Memory'));
    expect(memoryField?.value).toContain('Found:** 2 (scores 0.55–0.84)');
  });
});
