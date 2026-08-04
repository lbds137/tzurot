import { describe, it, expect } from 'vitest';
import type {
  DiagnosticPayload,
  DiagnosticPromptSection,
  PipelineStep,
} from '@tzurot/common-types/types/diagnostic';
import {
  buildPipelineHealthView,
  buildInputView,
  buildGenerationParamsView,
  buildPostProcessingView,
  buildCacheView,
} from './extendedViews.js';
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
    memoryRetrieval: { memoriesFound: [], freshModeEnabled: false },
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

describe('buildInputView', () => {
  it('renders all populated input sections as capped chunked text', () => {
    const payload = createMockPayload({
      inputProcessing: {
        rawUserMessage: 'What is the weather?',
        attachmentDescriptions: ['a photo of a cat', 'an audio clip'],
        voiceTranscript: 'what is the weather',
        referencedMessageIds: ['111', '222'],
        referencedMessagesContent: ['first referenced', 'second referenced'],
        searchQuery: 'weather',
      },
    });

    const result = buildInputView(payload, 'req-1', OWNER_CTX);

    const text = result.chunkedText?.text ?? '';
    expect(text).toContain('### Raw user message');
    expect(text).toContain('What is the weather?');
    expect(text).toContain('### Attachments (2)');
    expect(text).toContain('1. a photo of a cat');
    expect(text).toContain('### Voice transcript');
    expect(text).toContain('### Referenced messages');
    expect(text).toContain('`111`');
    expect(text).toContain('### Memory search query');
    expect(result.chunkedText?.maxChunks).toBe(3);
    expect(result.chunkedText?.overflowFilename).toBe('input-full.txt');
  });

  it('fence-escapes the transcript and search query (content-derived text)', () => {
    const payload = createMockPayload({
      inputProcessing: {
        rawUserMessage: 'hi',
        attachmentDescriptions: [],
        voiceTranscript: 'spoke ``` fence',
        referencedMessageIds: [],
        referencedMessagesContent: [],
        searchQuery: 'pasted ``` code',
      },
    });

    const text = buildInputView(payload, 'req-1', OWNER_CTX).chunkedText?.text ?? '';

    // A raw triple-backtick run would desync splitMessage's code-block
    // pairing; the escape interleaves zero-width spaces.
    expect(text).not.toContain('spoke ``` fence');
    expect(text).not.toContain('pasted ``` code');
    expect(text).toContain('spoke `\u200b`\u200b` fence');
  });

  it('omits absent sections entirely', () => {
    const result = buildInputView(createMockPayload(), 'req-1', OWNER_CTX);

    const text = result.chunkedText?.text ?? '';
    expect(text).toContain('### Raw user message');
    expect(text).not.toContain('### Attachments');
    expect(text).not.toContain('### Voice transcript');
    expect(text).not.toContain('### Referenced messages');
    expect(text).not.toContain('### Memory search query');
  });
});

describe('buildGenerationParamsView', () => {
  it('renders model, provider, set knobs, and inline allParams', () => {
    const payload = createMockPayload({
      llmConfig: {
        model: 'z-ai/glm-4.7',
        provider: 'openrouter',
        temperature: 0.9,
        topP: 0.95,
        maxTokens: 4000,
        allParams: { seed: 42, minP: 0.05 },
      },
    });

    const result = buildGenerationParamsView(payload, 'req-1', OWNER_CTX);
    const embed = result.embeds?.[0].toJSON();

    expect(embed?.description).toContain('`z-ai/glm-4.7`');
    expect(embed?.description).toContain('openrouter');
    expect(embed?.description).toContain('**Temperature:** 0.9');
    expect(embed?.description).toContain('**Top-p:** 0.95');
    expect(embed?.description).not.toContain('Top-k');
    expect(embed?.fields?.[0].value).toContain('"seed": 42');
  });

  it('notes when no sampling overrides are set and defers a huge allParams to Full JSON', () => {
    const result = buildGenerationParamsView(
      createMockPayload({
        llmConfig: {
          model: 'm',
          provider: 'p',
          allParams: { blob: 'x'.repeat(1200) },
        },
      }),
      'req-1',
      OWNER_CTX
    );
    const embed = result.embeds?.[0].toJSON();

    expect(embed?.description).toContain('No sampling overrides set');
    expect(embed?.fields?.[0].value).toContain('Full JSON');
  });
});

describe('buildPostProcessingView', () => {
  it('renders raw and final sections when post-processing changed the content', () => {
    const payload = createMockPayload({
      llmResponse: {
        rawContent: '<think>hmm</think>Hello!',
        finishReason: 'stop',
        promptTokens: 100,
        completionTokens: 47,
        modelUsed: 'm',
      },
    });

    const result = buildPostProcessingView(payload, 'req-1', OWNER_CTX);

    const text = result.chunkedText?.text ?? '';
    expect(text).toContain('### Raw model output');
    expect(text).toContain('<think>hmm</think>');
    expect(text).toContain('### Final after post-processing');
    expect(result.chunkedText?.maxChunks).toBe(3);
  });

  it('collapses to a single section when raw and final are identical', () => {
    const result = buildPostProcessingView(createMockPayload(), 'req-1', OWNER_CTX);

    const text = result.chunkedText?.text ?? '';
    expect(text).toContain('post-processing changed nothing');
    expect(text).not.toContain('### Raw model output');
  });
});

const SECTIONS: DiagnosticPromptSection[] = [
  { id: 'chat_log', tier: 'H', chars: 4200, offset: 900 },
  { id: 'system_identity', tier: 'S0', chars: 600, offset: 0 },
  { id: 'persona_card', tier: 'S1', chars: 300, offset: 600 },
];

function describeOf(result: ReturnType<typeof buildCacheView>): string {
  return result.embeds![0].data.description ?? '';
}

describe('buildCacheView', () => {
  it('renders cached vs total tokens, hit %, discount, and the section map', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 10000,
        cachedPromptTokens: 6272,
        cacheDiscount: -0.0123,
      },
      assembledPrompt: {
        messages: [],
        totalTokenEstimate: 0,
        systemPromptSections: SECTIONS,
      },
    });

    const result = buildCacheView(payload, 'req-1', OWNER_CTX);
    const text = describeOf(result);

    expect(result.embeds![0].data.title).toBe('♻️ Cache');
    expect(text).toContain('**Prompt tokens:** 10,000');
    expect(text).toContain('**Cached:** 6,272 (63%)');
    expect(text).toContain('**Cache discount:** -0.0123');
    expect(text).toContain('**Prefix map** (3 sections)');
    // Rows carry id, tier, chars, offset.
    expect(text).toContain('system_identity');
    expect(text).toContain('chat_log');
    expect(text).toContain('4,200');
    expect(text).toContain('900');
  });

  it('orders section rows by offset regardless of payload order', () => {
    const payload = createMockPayload({
      assembledPrompt: { messages: [], totalTokenEstimate: 0, systemPromptSections: SECTIONS },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    const identityAt = text.indexOf('system_identity');
    const personaAt = text.indexOf('persona_card');
    const chatAt = text.indexOf('chat_log');
    expect(identityAt).toBeGreaterThan(-1);
    expect(identityAt).toBeLessThan(personaAt);
    expect(personaAt).toBeLessThan(chatAt);
  });

  it('does not mutate the payload section array while ordering', () => {
    const sections = [...SECTIONS];
    const payload = createMockPayload({
      assembledPrompt: { messages: [], totalTokenEstimate: 0, systemPromptSections: sections },
    });

    buildCacheView(payload, 'req-1', OWNER_CTX);
    expect(sections.map(section => section.id)).toEqual([
      'chat_log',
      'system_identity',
      'persona_card',
    ]);
  });

  it('omits the hit percentage and bar when promptTokens is 0', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 0,
        cachedPromptTokens: 0,
      },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text).toContain('**Cached:** 0');
    expect(text).not.toContain('%');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Hit ');
  });

  it('renders a negative cached count without throwing (bar clamps at 0%)', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 1000,
        cachedPromptTokens: -50,
      },
    });

    // String.repeat throws on negative counts — the lower clamp is what keeps
    // the view's never-throws property against unvalidated provider data.
    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text).toContain('**Cached:** -50 (0%)');
    expect(text).toContain(`Hit ${'░'.repeat(15)}   0%`);
  });

  it('hides the prefix map from non-owners while keeping cache totals visible', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 10000,
        cachedPromptTokens: 6272,
      },
      assembledPrompt: {
        messages: [],
        totalTokenEstimate: 0,
        systemPromptSections: SECTIONS,
      },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', { canViewCharacter: false }));
    expect(text).toContain('**Cached:** 6,272 (63%)');
    expect(text).toContain('🔒');
    expect(text).not.toContain('system_identity');
    expect(text).not.toContain('chat_log');
  });

  it('clamps the hit bar at 100% when a provider reports cached > prompt tokens', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 1000,
        cachedPromptTokens: 1500,
      },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    // The raw count renders honestly; only the derived bar/percent clamp.
    expect(text).toContain('**Cached:** 1,500 (100%)');
    expect(text).toContain(`Hit ${'█'.repeat(15)} 100%`);
    expect(text).not.toContain('█'.repeat(16));
  });

  it('omits the discount line when the provider reported none', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 10000,
        cachedPromptTokens: 1000,
      },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text).toContain('**Cached:** 1,000 (10%)');
    expect(text).not.toContain('Cache discount');
  });

  it('renders a zero-cache report as a real cold prefix, not as missing data', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        cachedPromptTokens: 0,
      },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text).toContain('**Cached:** 0 (0%)');
    expect(text).not.toContain('no cache reporting');
  });

  it('degrades to an explanatory line when the log predates section tracking', () => {
    const payload = createMockPayload({
      llmResponse: {
        ...createMockPayload().llmResponse,
        promptTokens: 10000,
        cachedPromptTokens: 500,
      },
    });

    const result = buildCacheView(payload, 'req-1', OWNER_CTX);
    const text = describeOf(result);
    expect(text).toContain('predates system-prompt section tracking');
    expect(text).not.toContain('```\nSection');
  });

  it('notes an empty section map distinctly from an absent one', () => {
    const payload = createMockPayload({
      assembledPrompt: { messages: [], totalTokenEstimate: 0, systemPromptSections: [] },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text).toContain('No sections recorded for this request.');
    expect(text).not.toContain('predates system-prompt section tracking');
  });

  it('still opens with an explanation when the log carries no cache fields at all', () => {
    const result = buildCacheView(createMockPayload(), 'req-1', OWNER_CTX);
    const text = describeOf(result);

    expect(result.embeds).toHaveLength(1);
    expect(text).toContain('no cache reporting from the provider');
    expect(text).not.toContain('Cache discount');
    expect(text).toContain('predates system-prompt section tracking');
  });

  it('truncates long section ids so rows stay mobile-width', () => {
    const payload = createMockPayload({
      assembledPrompt: {
        messages: [],
        totalTokenEstimate: 0,
        systemPromptSections: [
          { id: 'an_extremely_long_section_identifier', tier: 'S1', chars: 10, offset: 0 },
        ],
      },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text).toContain('an_extremely_lon…');
    expect(text).not.toContain('an_extremely_long_section_identifier');
  });

  it('trims the table when the section map would overflow the embed description', () => {
    const many: DiagnosticPromptSection[] = Array.from({ length: 400 }, (_, i) => ({
      id: `section_${i}`,
      tier: 'V' as const,
      chars: 100,
      offset: i * 100,
    }));
    const payload = createMockPayload({
      assembledPrompt: { messages: [], totalTokenEstimate: 0, systemPromptSections: many },
    });

    const text = describeOf(buildCacheView(payload, 'req-1', OWNER_CTX));
    expect(text.length).toBeLessThanOrEqual(3900);
    expect(text).toContain('sections trimmed to fit');
    expect(text.endsWith('_')).toBe(true);
  });
});
