import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import {
  buildFullJsonView,
  buildCompactJsonView,
  buildSystemPromptView,
  buildReasoningView,
  buildMemoryInspectorView,
  buildTokenBudgetView,
  buildVoiceAttributionView,
} from './views.js';
import type { ViewContext } from './viewContext.js';

/** Owner context — character internals are visible (existing test behavior) */
const OWNER_CTX: ViewContext = { canViewCharacter: true };
/** Non-owner context — character internals are redacted */
const NON_OWNER_CTX: ViewContext = { canViewCharacter: false };

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
        { id: 'mem-1', score: 0.95, preview: 'Memory preview text', includedInPrompt: true },
        { id: 'mem-2', score: 0.52, preview: 'Low score memory', includedInPrompt: false },
      ],
      focusModeEnabled: false,
    },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 4000,
      memoryTokensUsed: 1000,
      historyTokensUsed: 92000,
      memoriesDropped: 1,
      historyMessagesDropped: 5,
    },
    assembledPrompt: {
      messages: [
        { role: 'system', content: '<persona>You are helpful.</persona>' },
        { role: 'user', content: 'Hello, how are you?' },
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

describe('buildFullJsonView', () => {
  it('should return a .json file attachment', () => {
    const payload = createMockPayload();
    const result = buildFullJsonView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toBe('debug-req-123.json');
    expect(result.flags).toBe(MessageFlags.Ephemeral);
  });

  it('should contain the full payload as JSON', () => {
    const payload = createMockPayload();
    const result = buildFullJsonView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    expect(parsed.meta.requestId).toBe('test-req-123');
    expect(parsed.assembledPrompt.messages[0].content).toContain('<persona>');
  });
});

describe('buildCompactJsonView', () => {
  it('should return a compact .json file', () => {
    const payload = createMockPayload();
    const result = buildCompactJsonView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('compact');
  });

  it('should replace system prompt with length summary', () => {
    const payload = createMockPayload();
    const result = buildCompactJsonView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    const systemMsg = parsed.assembledPrompt.messages.find(
      (m: { role: string }) => m.role === 'system'
    );
    expect(systemMsg.content).toMatch(/\[system prompt: \d+ chars\]/);
  });

  it('should keep user/assistant messages intact', () => {
    const payload = createMockPayload();
    const result = buildCompactJsonView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    const userMsg = parsed.assembledPrompt.messages.find(
      (m: { role: string }) => m.role === 'user'
    );
    expect(userMsg.content).toBe('Hello, how are you?');
  });

  it('should truncate long memory previews', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound[0].preview = 'x'.repeat(200);
    const result = buildCompactJsonView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    expect(parsed.memoryRetrieval.memoriesFound[0].preview.length).toBeLessThanOrEqual(103);
  });
});

describe('buildSystemPromptView', () => {
  it('should return an .xml file', () => {
    const payload = createMockPayload();
    const result = buildSystemPromptView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('.xml');
  });

  it('should wrap content in SystemPrompt tags', () => {
    const payload = createMockPayload();
    const result = buildSystemPromptView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('<SystemPrompt>');
    expect(content).toContain('</SystemPrompt>');
    expect(content).toContain('<persona>');
  });

  it('should handle missing system message', () => {
    const payload = createMockPayload();
    payload.assembledPrompt.messages = [{ role: 'user', content: 'Hello' }];
    const result = buildSystemPromptView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('No system message found');
  });
});

describe('buildReasoningView', () => {
  it('should show "no reasoning" message when thinkingContent is null', () => {
    const payload = createMockPayload();
    const result = buildReasoningView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('No reasoning content captured');
    expect(result.files).toBeUndefined();
    expect(result.flags).toBe(MessageFlags.Ephemeral);
  });

  it('should show "no reasoning" for empty string', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = '';
    const result = buildReasoningView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('No reasoning content captured');
  });

  it('should return inline chunked text for short reasoning', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = 'The user asked about castles...';
    const result = buildReasoningView(payload, 'req-123', OWNER_CTX);

    expect(result.chunkedText!.text).toContain('## Reasoning');
    expect(result.chunkedText!.text).toContain('castles');
    expect(result.files).toBeUndefined();
  });

  it('should return inline chunked text (never a file) for long reasoning', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = 'x'.repeat(2500);
    const result = buildReasoningView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toBeUndefined();
    expect(result.chunkedText!.text).toContain('x'.repeat(2500));
    expect(result.chunkedText!.continuedHeader).toContain('reasoning continued');
  });
});

describe('buildMemoryInspectorView', () => {
  it('should return inline content with no file attachment', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toBeUndefined();
    expect(result.content).toContain('# Memory Inspector');
  });

  it('should include search query and focus mode status', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('"hello"');
    expect(result.content).toContain('Disabled');
  });

  it('should include memory table with scores and status', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('0.95');
    expect(result.content).toContain('✓ in');
    expect(result.content).toContain('0.52');
    expect(result.content).toContain('✗ drop');
  });

  it('should show message when no memories found', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [];
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('No memories retrieved');
  });

  it('should collapse whitespace and truncate long previews to the row budget', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [
      {
        id: 'mem-1',
        score: 0.9,
        preview: 'line one\nline\ttwo  ' + 'y'.repeat(80),
        includedInPrompt: true,
      },
    ];
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    // Newlines/tabs collapse to single spaces so one memory = one table row
    expect(result.content).toContain('line one line two');
    expect(result.content).not.toContain('line one\nline');
    // 60-char row budget with ellipsis
    expect(result.content).toContain('…');
    expect(result.content).not.toContain('y'.repeat(80));
  });

  it('neutralizes embedded triple-backticks so previews cannot close the fence', () => {
    // Discord closes a fence at ANY ``` occurrence (not just line start) —
    // a pasted code block in a memory must not spill the table out of it.
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [
      { id: 'mem-1', score: 0.9, preview: 'pasted ```js x``` code', includedInPrompt: true },
    ];
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    // Only the table's own fence pair survives as raw triple-backticks
    expect(result.content!.match(/```/g)).toHaveLength(2);
    // Visible backticks still present (zero-width-separated)
    expect(result.content!.replace(/\u200b/g, '')).toContain('```js x```');
  });

  it('should show "none" for null search query', () => {
    const payload = createMockPayload();
    payload.inputProcessing.searchQuery = null;
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('_none_');
  });

  it('trims table rows from the tail when content would exceed one message', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = Array.from({ length: 40 }, (_, i) => ({
      id: `mem-${i}`,
      score: 0.9,
      preview: `row ${i} ` + 'z'.repeat(50),
      includedInPrompt: true,
    }));
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.content!.length).toBeLessThanOrEqual(1900);
    expect(result.content).toContain('rows trimmed to fit');
    // The token-budget summary after the closing fence survives the trim —
    // it matters most in exactly this high-memory-count case
    expect(result.content).toContain('**Token Budget:** 1000 tokens allocated');
    // Fence stays balanced (one open, one close)
    expect(result.content!.match(/```/g)).toHaveLength(2);
    // Filter buttons survive the trim — the view stays interactive
    expect(result.components).toHaveLength(1);
  });

  describe('filter / sort / Top-N state', () => {
    function memoryPayload() {
      const payload = createMockPayload();
      payload.memoryRetrieval.memoriesFound = [
        { id: 'm1', score: 0.9, preview: 'p1', includedInPrompt: true },
        { id: 'm2', score: 0.8, preview: 'p2', includedInPrompt: false },
        { id: 'm3', score: 0.7, preview: 'p3', includedInPrompt: true },
        { id: 'm4', score: 0.6, preview: 'p4', includedInPrompt: false },
        { id: 'm5', score: 0.5, preview: 'p5', includedInPrompt: true },
      ];
      return payload;
    }

    it('default state matches existing behavior (regression)', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX);
      const text = result.content!;
      // All 5 rows shown
      expect(text).toContain('p1');
      expect(text).toContain('p5');
      expect(text).toContain('5 total');
      expect(text).toContain('showing 5');
    });

    it('returns 5-button component row', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX);
      expect(result.components).toHaveLength(1);
      expect(result.components![0].components).toHaveLength(5);
    });

    it('omits filter buttons and state line when there are no retrieved memories', () => {
      const payload = memoryPayload();
      payload.memoryRetrieval.memoriesFound = [];
      const result = buildMemoryInspectorView(payload, 'req-1', OWNER_CTX);
      const text = result.content!;

      expect(result.components).toEqual([]);
      // State annotation should not appear — there's nothing to filter
      expect(text).not.toContain('**Filter:**');
      expect(text).toContain('No memories retrieved');
    });

    it('filter=included shows only included rows', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'included',
        topN: 0,
        sort: 'score-desc',
      });
      const text = result.content!;
      expect(text).toContain('p1');
      expect(text).not.toContain('p2');
      expect(text).toContain('p3');
      expect(text).not.toContain('p4');
      expect(text).toContain('p5');
    });

    it('filter=dropped shows only dropped rows', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'dropped',
        topN: 0,
        sort: 'score-desc',
      });
      const text = result.content!;
      expect(text).not.toContain('p1');
      expect(text).toContain('p2');
      expect(text).not.toContain('p3');
      expect(text).toContain('p4');
      expect(text).not.toContain('p5');
    });

    it('topN=5 covers all 5 fixture rows', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'all',
        topN: 5,
        sort: 'score-desc',
      });
      const text = result.content!;
      expect(text).toContain('showing 5');
    });

    it('sort=score-asc puts lowest score first', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'all',
        topN: 0,
        sort: 'score-asc',
      });
      const text = result.content!;
      // First row index is 1, lowest-scored memory (p5 with 0.50) should be there
      const firstRowMatch = text.match(/^ 1 (\d+\.\d+) /m);
      expect(firstRowMatch?.[1]).toBe('0.50');
    });

    it('sort=included-first groups included rows above dropped', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'all',
        topN: 0,
        sort: 'included-first',
      });
      const text = result.content!;
      const p1Idx = text.indexOf('p1'); // included
      const p3Idx = text.indexOf('p3'); // included
      const p5Idx = text.indexOf('p5'); // included
      const p2Idx = text.indexOf('p2'); // dropped
      const p4Idx = text.indexOf('p4'); // dropped
      // All included rows appear before any dropped row
      expect(Math.max(p1Idx, p3Idx, p5Idx)).toBeLessThan(Math.min(p2Idx, p4Idx));
    });

    it('combined filter + topN + sort: included + topN=5 + score-asc', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'included',
        topN: 5,
        sort: 'score-asc',
      });
      const text = result.content!;
      // Included memories sorted by ascending score: p5 (0.5), p3 (0.7), p1 (0.9)
      // topN=5 covers all 3
      const p5Idx = text.indexOf('p5');
      const p3Idx = text.indexOf('p3');
      const p1Idx = text.indexOf('p1');
      expect(p5Idx).toBeLessThan(p3Idx);
      expect(p3Idx).toBeLessThan(p1Idx);
    });

    it('empty result after filtering shows "no memories match" message', () => {
      const payload = memoryPayload();
      // All memories are included, so filter=dropped → empty
      payload.memoryRetrieval.memoriesFound = payload.memoryRetrieval.memoriesFound.map(m => ({
        ...m,
        includedInPrompt: true,
      }));
      const result = buildMemoryInspectorView(payload, 'req-1', OWNER_CTX, {
        filter: 'dropped',
        topN: 0,
        sort: 'score-desc',
      });
      const text = result.content!;
      expect(text).toContain('No memories match filter');
    });

    it('non-owner with filter applied still redacts previews', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', NON_OWNER_CTX, {
        filter: 'included',
        topN: 0,
        sort: 'score-desc',
      });
      const text = result.content!;
      expect(text).toContain('[REDACTED]');
      expect(text).not.toContain('p1');
      expect(text).not.toContain('p3');
    });
  });
});

describe('buildTokenBudgetView', () => {
  /** Pull the Notes field value off the embed (empty string when absent) */
  function notesOf(result: ReturnType<typeof buildTokenBudgetView>): string {
    const field = result.embeds![0].data.fields?.find(f => f.name === 'Notes');
    return field?.value ?? '';
  }

  it('should return an embed with no file attachment', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toBeUndefined();
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds![0].data.title).toBe('\u{1F4CA} Token Budget');
  });

  it('should include context window size and a bar per allocation', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const desc = result.embeds![0].data.description ?? '';
    expect(desc).toContain('128,000');
    expect(desc).toContain('System');
    expect(desc).toContain('Memory');
    expect(desc).toContain('History');
    expect(desc).toContain('Free');
    expect(desc).toContain('\u2588'); // at least one filled bar segment
  });

  it('should warn in Notes and switch to the warning color when history > 70%', () => {
    const payload = createMockPayload();
    // 92000 / 128000 = 71.9%
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(notesOf(result)).toContain('over 70%');
    expect(result.embeds![0].data.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('should use the default color when history is under the warning threshold', () => {
    const payload = createMockPayload();
    payload.tokenBudget.historyTokensUsed = 10000;
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(notesOf(result)).not.toContain('over 70%');
    expect(result.embeds![0].data.color).toBe(DISCORD_COLORS.BLURPLE);
  });

  it('should show dropped counts in Notes', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const notes = notesOf(result);
    expect(notes).toContain('1 memories');
    expect(notes).toContain('5 history messages');
  });

  it('should not show the dropped line when nothing was dropped', () => {
    const payload = createMockPayload();
    payload.tokenBudget.memoriesDropped = 0;
    payload.tokenBudget.historyMessagesDropped = 0;
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(notesOf(result)).not.toContain('Dropped for budget');
  });

  it('renders the cross-channel line when crossChannelMessagesIncluded is set', () => {
    const payload = createMockPayload();
    payload.tokenBudget.crossChannelMessagesIncluded = 3;
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(notesOf(result)).toContain('Cross-channel: 3 msgs included from other channels');
  });

  it('renders "0 msgs" when cross-channel was enabled but produced no eligible messages', () => {
    // The exact silent-skip case the diagnostic exists to surface — this test
    // pins the empty-but-enabled visibility so a future refactor that
    // collapses 0 to undefined re-introduces the gap loudly.
    const payload = createMockPayload();
    payload.tokenBudget.crossChannelMessagesIncluded = 0;
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(notesOf(result)).toContain('Cross-channel: 0 msgs included from other channels');
  });

  it('omits the cross-channel line when the feature was disabled this turn', () => {
    const payload = createMockPayload();
    // crossChannelMessagesIncluded intentionally undefined
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(notesOf(result)).not.toContain('Cross-channel:');
  });

  it('does not render voice attribution (moved to its own view)', () => {
    const payload = createMockPayload();
    payload.tokenBudget.ttsProviderUsed = 'mistral';
    payload.tokenBudget.ttsUsedFallback = true;
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const desc = result.embeds![0].data.description ?? '';
    expect(desc).not.toContain('mistral');
    expect(notesOf(result)).not.toContain('mistral');
  });
});

describe('buildVoiceAttributionView', () => {
  it('reports no voice activity when neither TTS nor a transcript is present', () => {
    const payload = createMockPayload();
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('No voice activity');
    expect(result.chunkedText).toBeUndefined();
  });

  it('renders the TTS provider without a fallback suffix when no fallback fired', () => {
    const payload = createMockPayload();
    payload.tokenBudget.ttsProviderUsed = 'mistral';
    payload.tokenBudget.ttsUsedFallback = false;
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    const text = result.chunkedText!.text;
    expect(text).toContain('**TTS provider:** mistral');
    expect(text).not.toContain('(via fallback)');
  });

  it('annotates "(via fallback)" when the dispatcher fell through', () => {
    // Regression contract for the silent-fallback misattribution class —
    // user configures Mistral, Mistral fails, voice-engine produces audio,
    // diagnostic UI must surface the divergence so the user can tell.
    const payload = createMockPayload();
    payload.tokenBudget.ttsProviderUsed = 'self-hosted';
    payload.tokenBudget.ttsUsedFallback = true;
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    expect(result.chunkedText!.text).toContain('**TTS provider:** self-hosted _(via fallback)_');
  });

  it('omits the "(via fallback)" suffix when ttsUsedFallback is undefined', () => {
    // The renderer uses strict `=== true` so undefined renders the bare line.
    // Pipeline always sets the two fields together, but pinning the strict
    // check here guards against a future contributor flipping to a truthy
    // comparison that would render "(via fallback)" on undefined.
    const payload = createMockPayload();
    payload.tokenBudget.ttsProviderUsed = 'mistral';
    payload.tokenBudget.ttsUsedFallback = undefined;
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    const text = result.chunkedText!.text;
    expect(text).toContain('**TTS provider:** mistral');
    expect(text).not.toContain('(via fallback)');
  });

  it('renders the voice transcript as a blockquote', () => {
    const payload = createMockPayload();
    payload.inputProcessing.voiceTranscript = 'hello from a voice note';
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    const text = result.chunkedText!.text;
    expect(text).toContain('**Voice transcript:**');
    expect(text).toContain('> hello from a voice note');
  });

  it('quotes every line of a multi-line transcript', () => {
    // Discord drops unprefixed continuation lines out of a blockquote
    const payload = createMockPayload();
    payload.inputProcessing.voiceTranscript = 'first line\nsecond line';
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    const text = result.chunkedText!.text;
    expect(text).toContain('> first line\n> second line');
  });

  it('renders transcript-only requests (voice input, no TTS reply)', () => {
    const payload = createMockPayload();
    payload.inputProcessing.voiceTranscript = 'transcript only';
    // ttsProviderUsed intentionally undefined
    const result = buildVoiceAttributionView(payload, 'req-123', OWNER_CTX);

    const text = result.chunkedText!.text;
    expect(text).toContain('> transcript only');
    expect(text).not.toContain('**TTS provider:**');
  });
});

// ---------------------------------------------------------------------------
// Non-owner redaction paths
// ---------------------------------------------------------------------------

describe('non-owner redaction', () => {
  describe('buildFullJsonView', () => {
    it('redacts the system-prompt message body when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildFullJsonView(payload, 'req-123', NON_OWNER_CTX);
      const parsed = JSON.parse(result.files![0].attachment.toString());
      const systemMsg = parsed.assembledPrompt.messages.find(
        (m: { role: string }) => m.role === 'system'
      );
      expect(systemMsg.content).toContain('REDACTED');
      expect(systemMsg.content).not.toContain('<persona>');
    });

    it('redacts memory previews when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildFullJsonView(payload, 'req-123', NON_OWNER_CTX);
      const parsed = JSON.parse(result.files![0].attachment.toString());
      for (const memory of parsed.memoryRetrieval.memoriesFound) {
        expect(memory.preview).toBe('[REDACTED]');
      }
    });

    it('preserves user/assistant messages when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildFullJsonView(payload, 'req-123', NON_OWNER_CTX);
      const parsed = JSON.parse(result.files![0].attachment.toString());
      const userMsg = parsed.assembledPrompt.messages.find(
        (m: { role: string }) => m.role === 'user'
      );
      expect(userMsg.content).toBe('Hello, how are you?');
    });

    it('preserves memory IDs and scores when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildFullJsonView(payload, 'req-123', NON_OWNER_CTX);
      const parsed = JSON.parse(result.files![0].attachment.toString());
      expect(parsed.memoryRetrieval.memoriesFound[0].id).toBe('mem-1');
      expect(parsed.memoryRetrieval.memoriesFound[0].score).toBe(0.95);
      expect(parsed.memoryRetrieval.memoriesFound[0].includedInPrompt).toBe(true);
    });
  });

  describe('buildCompactJsonView', () => {
    it('redacts memory previews when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildCompactJsonView(payload, 'req-123', NON_OWNER_CTX);
      const parsed = JSON.parse(result.files![0].attachment.toString());
      for (const memory of parsed.memoryRetrieval.memoriesFound) {
        expect(memory.preview).toBe('[REDACTED]');
      }
    });

    it('keeps system-prompt summary intact when canViewCharacter is false (non-leaking)', () => {
      const payload = createMockPayload();
      const result = buildCompactJsonView(payload, 'req-123', NON_OWNER_CTX);
      const parsed = JSON.parse(result.files![0].attachment.toString());
      const systemMsg = parsed.assembledPrompt.messages.find(
        (m: { role: string }) => m.role === 'system'
      );
      // System prompt gets the same length-summary as for owners — the actual
      // content was never exposed in compact form anyway, just its length.
      expect(systemMsg.content).toMatch(/\[system prompt: \d+ chars\]/);
    });
  });

  describe('buildSystemPromptView', () => {
    it('returns the 🔒 affordance message instead of XML when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildSystemPromptView(payload, 'req-123', NON_OWNER_CTX);
      expect(result.content).toContain('🔒');
      expect(result.content).toContain('Character card hidden');
      expect(result.files).toBeUndefined();
      // No `flags` field — editReply cannot change ephemeral state set on the
      // initial defer, so the lock affordance relies on the /inspect command
      // itself having deferred ephemeral.
      expect(result.flags).toBeUndefined();
    });

    it('does NOT include any of the system prompt content when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildSystemPromptView(payload, 'req-123', NON_OWNER_CTX);
      expect(result.content).not.toContain('<persona>');
      expect(result.content).not.toContain('You are helpful');
    });
  });

  describe('buildMemoryInspectorView', () => {
    it('redacts memory previews while keeping IDs/scores/inclusion visible', () => {
      const payload = createMockPayload();
      const result = buildMemoryInspectorView(payload, 'req-123', NON_OWNER_CTX);
      const content = result.content!;
      // Each memory row contains [REDACTED] in the preview column
      expect(content).toContain('[REDACTED]');
      // Score and status remain
      expect(content).toContain('0.95');
      expect(content).toContain('✓ in');
      // Banner explaining the redaction
      expect(content).toContain('🔒');
      expect(content).toContain('redacted');
    });

    it('does not show memory preview text when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildMemoryInspectorView(payload, 'req-123', NON_OWNER_CTX);
      const content = result.content!;
      expect(content).not.toContain('Memory preview text');
      expect(content).not.toContain('Low score memory');
    });
  });

  describe('buildReasoningView', () => {
    it('shows reasoning content even when canViewCharacter is false (per project decision)', () => {
      const payload = createMockPayload();
      payload.postProcessing.thinkingContent = 'I considered the user request and decided to...';
      const result = buildReasoningView(payload, 'req-123', NON_OWNER_CTX);
      expect(result.chunkedText!.text).toContain('considered the user request');
    });
  });

  describe('buildTokenBudgetView', () => {
    it('shows full token-budget breakdown even when canViewCharacter is false (purely numeric)', () => {
      const payload = createMockPayload();
      const result = buildTokenBudgetView(payload, 'req-123', NON_OWNER_CTX);
      const desc = result.embeds![0].data.description ?? '';
      expect(desc).toContain('Context window:');
      expect(desc).toContain('System');
    });
  });

  describe('buildVoiceAttributionView', () => {
    it('renders TTS attribution for non-owners as well (no ownership gate)', () => {
      // Pins the intentional design: TTS provider attribution is a non-sensitive
      // numeric/categorical field, same class as the other token-budget lines,
      // so non-owners also see it. Without this assertion, a future contributor
      // could add an ownership gate to the TTS line and the test suite would
      // accept the change silently.
      const payload = createMockPayload();
      payload.tokenBudget.ttsProviderUsed = 'mistral';
      payload.tokenBudget.ttsUsedFallback = false;
      const result = buildVoiceAttributionView(payload, 'req-123', NON_OWNER_CTX);
      expect(result.chunkedText!.text).toContain('**TTS provider:** mistral');
    });
  });
});
