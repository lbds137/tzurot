import { describe, it, expect } from 'vitest';
import type { DiagnosticPayload, PipelineStep } from '@tzurot/common-types';
import { buildPipelineHealthView, buildQuickCopySummaryView } from './extendedViews.js';
import type { ViewContext } from './viewContext.js';

const OWNER_CTX: ViewContext = { canViewCharacter: true };

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
      searchQuery: null,
    },
    memoryRetrieval: { memoriesFound: [], focusModeEnabled: false },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 4000,
      memoryTokensUsed: 0,
      historyTokensUsed: 0,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    },
    assembledPrompt: { messages: [], totalTokenEstimate: 0 },
    llmConfig: {
      model: 'z-ai/glm-4.7',
      provider: 'openrouter',
      stopSequences: [],
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hello!',
      finishReason: 'stop',
      stopSequenceTriggered: null,
      promptTokens: 100,
      completionTokens: 47,
      modelUsed: 'z-ai/glm-4.7',
    },
    postProcessing: {
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: 'Hello!',
    },
    timing: { totalDurationMs: 9600 },
    ...overrides,
  };
}

describe('buildPipelineHealthView', () => {
  it('renders a markdown checklist when pipelineSteps are present', () => {
    const steps: PipelineStep[] = [
      { name: 'duplicate_removal', status: 'success', reason: 'removed 6 chars' },
      { name: 'thinking_extraction', status: 'skipped', reason: 'no reasoning content found' },
      { name: 'artifact_strip', status: 'error', reason: 'regex failed' },
    ];

    const payload = createMockPayload({
      postProcessing: {
        transformsApplied: ['duplicate_removal'],
        duplicateDetected: true,
        thinkingExtracted: false,
        thinkingContent: null,
        artifactsStripped: [],
        finalContent: 'Hi',
        pipelineSteps: steps,
      },
    });

    const result = buildPipelineHealthView(payload, 'req-1', OWNER_CTX);
    expect(result.files).toHaveLength(1);
    const file = result.files![0];
    const text = file.attachment.toString();

    expect(text).toContain('# Pipeline Health');
    expect(text).toContain('| `duplicate_removal` | ✅ success | removed 6 chars |');
    expect(text).toContain('| `thinking_extraction` | ⏭️ skipped | no reasoning content found |');
    expect(text).toContain('| `artifact_strip` | ❌ error | regex failed |');
    expect(text).toContain('## Context');
    expect(file.name).toBe('pipeline-health-req-1.md');
  });

  it('falls back to transformsApplied when pipelineSteps is missing (legacy log)', () => {
    const payload = createMockPayload({
      postProcessing: {
        transformsApplied: ['duplicate_removal', 'thinking_extraction'],
        duplicateDetected: true,
        thinkingExtracted: true,
        thinkingContent: 'Plan',
        artifactsStripped: [],
        finalContent: 'Hi',
        // pipelineSteps intentionally omitted
      },
    });

    const result = buildPipelineHealthView(payload, 'req-2', OWNER_CTX);
    const text = result.files![0].attachment.toString();

    expect(text).toContain('predates structured pipeline step tracking');
    expect(text).toContain('- ✅ `duplicate_removal`');
    expect(text).toContain('- ✅ `thinking_extraction`');
  });

  it('reports "No transforms applied" when both pipelineSteps and transformsApplied are empty', () => {
    const payload = createMockPayload(); // default postProcessing has empty arrays
    const result = buildPipelineHealthView(payload, 'req-3', OWNER_CTX);
    const text = result.files![0].attachment.toString();
    expect(text).toContain('No transforms applied');
  });

  it('surfaces final content / thinking length / artifacts in the Context section', () => {
    const payload = createMockPayload({
      postProcessing: {
        transformsApplied: [],
        duplicateDetected: false,
        thinkingExtracted: true,
        thinkingContent: 'a'.repeat(1063),
        artifactsStripped: ['<reasoning>'],
        finalContent: 'a'.repeat(2048),
        pipelineSteps: [],
      },
    });

    const result = buildPipelineHealthView(payload, 'req-4', OWNER_CTX);
    const text = result.files![0].attachment.toString();

    expect(text).toContain('**Final content:** 2,048 chars');
    expect(text).toContain('**Thinking content:** 1,063 chars');
    expect(text).toContain('**Artifacts stripped:** <reasoning>');
  });

  it('distinguishes empty pipelineSteps (new log, no steps) from missing pipelineSteps (legacy log)', () => {
    const newLogEmpty = createMockPayload({
      postProcessing: {
        transformsApplied: ['duplicate_removal'],
        duplicateDetected: true,
        thinkingExtracted: false,
        thinkingContent: null,
        artifactsStripped: [],
        finalContent: 'Hi',
        pipelineSteps: [],
      },
    });

    const result = buildPipelineHealthView(newLogEmpty, 'req-empty', OWNER_CTX);
    const text = result.files![0].attachment.toString();

    expect(text).toContain('No pipeline steps recorded');
    // Should NOT show the legacy-log fallback message — this log is new, just empty
    expect(text).not.toContain('predates structured pipeline step tracking');
  });
});

describe('buildQuickCopySummaryView', () => {
  it('formats a single-line summary with provider, duration, tokens, thinking', () => {
    const payload = createMockPayload({
      llmResponse: {
        rawContent: 'Hi',
        finishReason: 'stop',
        stopSequenceTriggered: null,
        promptTokens: 100,
        completionTokens: 47,
        modelUsed: 'z-ai/glm-4.7',
        reasoningDebug: {
          additionalKwargsKeys: [],
          hasReasoningInKwargs: true,
          reasoningKwargsLength: 1063,
          responseMetadataKeys: [],
          hasReasoningDetails: false,
          hasReasoningTagsInContent: false,
          rawContentPreview: 'Hi',
          upstreamProvider: 'DekaLLM',
        },
      },
      postProcessing: {
        transformsApplied: [],
        duplicateDetected: false,
        thinkingExtracted: true,
        thinkingContent: 'a'.repeat(1063),
        artifactsStripped: [],
        finalContent: 'Hi',
      },
      timing: { totalDurationMs: 9600 },
    });

    const result = buildQuickCopySummaryView(payload, 'req-5', OWNER_CTX);
    expect(result.content).toBeDefined();
    expect(result.content).toContain('**Quick copy:**');
    expect(result.content).toContain('z-ai/glm-4.7 via DekaLLM');
    expect(result.content).toContain('9.6s');
    expect(result.content).toContain('47 tok');
    expect(result.content).toContain('thinking 1,063 chars');
  });

  it('omits the upstream-provider segment when reasoningDebug is absent', () => {
    const payload = createMockPayload();
    const result = buildQuickCopySummaryView(payload, 'req-6', OWNER_CTX);
    expect(result.content).toContain('z-ai/glm-4.7 ·');
    expect(result.content).not.toContain('via');
  });

  it('omits the thinking segment when thinkingContent is empty', () => {
    const payload = createMockPayload();
    const result = buildQuickCopySummaryView(payload, 'req-7', OWNER_CTX);
    expect(result.content).not.toContain('thinking');
  });
});
