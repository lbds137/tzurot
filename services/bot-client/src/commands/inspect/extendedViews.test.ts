import { describe, it, expect } from 'vitest';
import type { DiagnosticPayload, PipelineStep } from '@tzurot/common-types/types/diagnostic';
import { buildPipelineHealthView } from './extendedViews.js';
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
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hello!',
      finishReason: 'stop',
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
    expect(result.files).toBeUndefined();
    const text = result.embeds![0].data.description ?? '';

    expect(result.embeds![0].data.title).toBe('🩺 Pipeline Health');
    // Two lines per step: emoji + name, then the reason as a subtext line
    expect(text).toContain('✅ `duplicate_removal`');
    expect(text).toContain('-# removed 6 chars');
    expect(text).toContain('⏭️ `thinking_extraction`');
    expect(text).toContain('-# no reasoning content found');
    expect(text).toContain('❌ `artifact_strip`');
    expect(text).toContain('-# regex failed');
    const content = result.embeds![0].data.fields?.find(f => f.name === 'Content');
    expect(content).toBeDefined();
  });

  it('neutralizes embedded triple-backticks in step reasons', () => {
    // Reasons can carry content-derived text; a ``` inside one must not
    // close the table fence or mis-pair splitMessage's code-block detection.
    const payload = createMockPayload({
      postProcessing: {
        transformsApplied: [],
        duplicateDetected: false,
        thinkingExtracted: false,
        thinkingContent: null,
        artifactsStripped: [],
        finalContent: 'Hi',
        pipelineSteps: [
          { name: 'artifact_strip', status: 'error', reason: 'choked on ```xml block```' },
        ],
      },
    });

    const result = buildPipelineHealthView(payload, 'req-1', OWNER_CTX);
    const text = result.embeds![0].data.description ?? '';

    // No fence wraps the steps anymore — a raw ``` in a reason would OPEN a
    // block mid-description, so the neutralizer must leave zero raw runs
    expect(text.match(/```/g)).toBeNull();
    expect(text.replace(/\u200b/g, '')).toContain('choked on ```xml block```');
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
    const text = result.embeds![0].data.description ?? '';

    expect(text).toContain('predates structured pipeline step tracking');
    expect(text).toContain('- ✅ `duplicate_removal`');
    expect(text).toContain('- ✅ `thinking_extraction`');
  });

  it('reports "No transforms applied" when both pipelineSteps and transformsApplied are empty', () => {
    const payload = createMockPayload(); // default postProcessing has empty arrays
    const result = buildPipelineHealthView(payload, 'req-3', OWNER_CTX);
    const text = result.embeds![0].data.description ?? '';
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
    const content = result.embeds![0].data.fields?.find(f => f.name === 'Content');
    expect(content?.value).toContain('**Final:** 2,048 chars');
    expect(content?.value).toContain('**Thinking:** 1,063 chars');
    expect(content?.value).toContain('**Artifacts stripped:** <reasoning>');
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
    const text = result.embeds![0].data.description ?? '';

    expect(text).toContain('No pipeline steps recorded');
    // Should NOT show the legacy-log fallback message — this log is new, just empty
    expect(text).not.toContain('predates structured pipeline step tracking');
  });
});
