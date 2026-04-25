import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { DiagnosticPayload } from '@tzurot/common-types';
import {
  buildFullJsonView,
  buildCompactJsonView,
  buildSystemPromptView,
  buildReasoningView,
  buildMemoryInspectorView,
  buildTokenBudgetView,
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

  it('should return inline message for short reasoning', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = 'The user asked about castles...';
    const result = buildReasoningView(payload, 'req-123', OWNER_CTX);

    expect(result.content).toContain('## Reasoning');
    expect(result.content).toContain('castles');
    expect(result.files).toBeUndefined();
  });

  it('should return .md file for long reasoning', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = 'x'.repeat(2500);
    const result = buildReasoningView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('.md');
    expect(result.content).toContain('2,500 chars');
  });
});

describe('buildMemoryInspectorView', () => {
  it('should return a .md file', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('memory-inspector');
  });

  it('should include search query and focus mode status', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('"hello"');
    expect(content).toContain('Disabled');
  });

  it('should include memory table with scores and status', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('0.95');
    expect(content).toContain('Included');
    expect(content).toContain('0.52');
    expect(content).toContain('Dropped (budget)');
  });

  it('should show message when no memories found', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [];
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('No memories retrieved');
  });

  it('should escape pipes and backslashes in memory previews', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [
      { id: 'mem-1', score: 0.9, preview: 'has | pipe and \\ backslash', includedInPrompt: true },
    ];
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('has \\| pipe and \\\\ backslash');
  });

  it('should show "none" for null search query', () => {
    const payload = createMockPayload();
    payload.inputProcessing.searchQuery = null;
    const result = buildMemoryInspectorView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('_none_');
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
      const text = result.files![0].attachment.toString();
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

    it('filter=included shows only included rows', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'included',
        topN: 0,
        sort: 'score-desc',
      });
      const text = result.files![0].attachment.toString();
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
      const text = result.files![0].attachment.toString();
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
      const text = result.files![0].attachment.toString();
      expect(text).toContain('showing 5');
    });

    it('sort=score-asc puts lowest score first', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'all',
        topN: 0,
        sort: 'score-asc',
      });
      const text = result.files![0].attachment.toString();
      // First row index is 1, lowest-scored memory (p5 with 0.50) should be there
      const firstRowMatch = text.match(/\| 1 \| (\d+\.\d+) \|/);
      expect(firstRowMatch?.[1]).toBe('0.50');
    });

    it('sort=included-first groups included rows above dropped', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', OWNER_CTX, {
        filter: 'all',
        topN: 0,
        sort: 'included-first',
      });
      const text = result.files![0].attachment.toString();
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
      const text = result.files![0].attachment.toString();
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
      const text = result.files![0].attachment.toString();
      expect(text).toContain('No memories match filter');
    });

    it('non-owner with filter applied still redacts previews', () => {
      const result = buildMemoryInspectorView(memoryPayload(), 'req-1', NON_OWNER_CTX, {
        filter: 'included',
        topN: 0,
        sort: 'score-desc',
      });
      const text = result.files![0].attachment.toString();
      expect(text).toContain('[REDACTED]');
      expect(text).not.toContain('p1');
      expect(text).not.toContain('p3');
    });
  });
});

describe('buildTokenBudgetView', () => {
  it('should return a .txt file', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('token-budget');
    expect(result.files![0].name).toContain('.txt');
  });

  it('should include context window size', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('128,000');
  });

  it('should show history warning when > 70%', () => {
    const payload = createMockPayload();
    // 92000 / 128000 = 71.9%
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('>70%');
  });

  it('should show dropped counts', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).toContain('1 memories');
    expect(content).toContain('5 history messages');
  });

  it('should not show dropped line when nothing dropped', () => {
    const payload = createMockPayload();
    payload.tokenBudget.memoriesDropped = 0;
    payload.tokenBudget.historyMessagesDropped = 0;
    const result = buildTokenBudgetView(payload, 'req-123', OWNER_CTX);

    const content = result.files![0].attachment.toString();
    expect(content).not.toContain('Dropped:');
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
      const content = result.files![0].attachment.toString();
      // Each memory row contains [REDACTED] in the preview column
      expect(content).toContain('[REDACTED]');
      // Score and status remain
      expect(content).toContain('0.95');
      expect(content).toContain('Included');
      // Banner explaining the redaction
      expect(content).toContain('🔒');
      expect(content).toContain('redacted');
    });

    it('does not show memory preview text when canViewCharacter is false', () => {
      const payload = createMockPayload();
      const result = buildMemoryInspectorView(payload, 'req-123', NON_OWNER_CTX);
      const content = result.files![0].attachment.toString();
      expect(content).not.toContain('Memory preview text');
      expect(content).not.toContain('Low score memory');
    });
  });

  describe('buildReasoningView', () => {
    it('shows reasoning content even when canViewCharacter is false (per project decision)', () => {
      const payload = createMockPayload();
      payload.postProcessing.thinkingContent = 'I considered the user request and decided to...';
      const result = buildReasoningView(payload, 'req-123', NON_OWNER_CTX);
      expect(result.content).toContain('considered the user request');
    });
  });

  describe('buildTokenBudgetView', () => {
    it('shows full token-budget breakdown even when canViewCharacter is false (purely numeric)', () => {
      const payload = createMockPayload();
      const result = buildTokenBudgetView(payload, 'req-123', NON_OWNER_CTX);
      const content = result.files![0].attachment.toString();
      expect(content).toContain('Context Window');
      expect(content).toContain('System Prompt:');
    });
  });
});
