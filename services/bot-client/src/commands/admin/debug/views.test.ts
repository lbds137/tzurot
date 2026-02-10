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
    const result = buildFullJsonView(payload, 'req-123');

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toBe('debug-req-123.json');
    expect(result.flags).toBe(MessageFlags.Ephemeral);
  });

  it('should contain the full payload as JSON', () => {
    const payload = createMockPayload();
    const result = buildFullJsonView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    expect(parsed.meta.requestId).toBe('test-req-123');
    expect(parsed.assembledPrompt.messages[0].content).toContain('<persona>');
  });
});

describe('buildCompactJsonView', () => {
  it('should return a compact .json file', () => {
    const payload = createMockPayload();
    const result = buildCompactJsonView(payload, 'req-123');

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('compact');
  });

  it('should replace system prompt with length summary', () => {
    const payload = createMockPayload();
    const result = buildCompactJsonView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    const systemMsg = parsed.assembledPrompt.messages.find(
      (m: { role: string }) => m.role === 'system'
    );
    expect(systemMsg.content).toMatch(/\[system prompt: \d+ chars\]/);
  });

  it('should keep user/assistant messages intact', () => {
    const payload = createMockPayload();
    const result = buildCompactJsonView(payload, 'req-123');

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
    const result = buildCompactJsonView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    const parsed = JSON.parse(content);
    expect(parsed.memoryRetrieval.memoriesFound[0].preview.length).toBeLessThanOrEqual(103);
  });
});

describe('buildSystemPromptView', () => {
  it('should return an .xml file', () => {
    const payload = createMockPayload();
    const result = buildSystemPromptView(payload, 'req-123');

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('.xml');
  });

  it('should wrap content in SystemPrompt tags', () => {
    const payload = createMockPayload();
    const result = buildSystemPromptView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('<SystemPrompt>');
    expect(content).toContain('</SystemPrompt>');
    expect(content).toContain('<persona>');
  });

  it('should handle missing system message', () => {
    const payload = createMockPayload();
    payload.assembledPrompt.messages = [{ role: 'user', content: 'Hello' }];
    const result = buildSystemPromptView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('No system message found');
  });
});

describe('buildReasoningView', () => {
  it('should show "no reasoning" message when thinkingContent is null', () => {
    const payload = createMockPayload();
    const result = buildReasoningView(payload, 'req-123');

    expect(result.content).toContain('No reasoning content captured');
    expect(result.files).toBeUndefined();
    expect(result.flags).toBe(MessageFlags.Ephemeral);
  });

  it('should show "no reasoning" for empty string', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = '';
    const result = buildReasoningView(payload, 'req-123');

    expect(result.content).toContain('No reasoning content captured');
  });

  it('should return inline message for short reasoning', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = 'The user asked about castles...';
    const result = buildReasoningView(payload, 'req-123');

    expect(result.content).toContain('## Reasoning');
    expect(result.content).toContain('castles');
    expect(result.files).toBeUndefined();
  });

  it('should return .md file for long reasoning', () => {
    const payload = createMockPayload();
    payload.postProcessing.thinkingContent = 'x'.repeat(2500);
    const result = buildReasoningView(payload, 'req-123');

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('.md');
    expect(result.content).toContain('2,500 chars');
  });
});

describe('buildMemoryInspectorView', () => {
  it('should return a .md file', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123');

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('memory-inspector');
  });

  it('should include search query and focus mode status', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('"hello"');
    expect(content).toContain('Disabled');
  });

  it('should include memory table with scores and status', () => {
    const payload = createMockPayload();
    const result = buildMemoryInspectorView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('0.95');
    expect(content).toContain('Included');
    expect(content).toContain('0.52');
    expect(content).toContain('Dropped (budget)');
  });

  it('should show message when no memories found', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [];
    const result = buildMemoryInspectorView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('No memories retrieved');
  });

  it('should escape pipes and backslashes in memory previews', () => {
    const payload = createMockPayload();
    payload.memoryRetrieval.memoriesFound = [
      { id: 'mem-1', score: 0.9, preview: 'has | pipe and \\ backslash', includedInPrompt: true },
    ];
    const result = buildMemoryInspectorView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('has \\| pipe and \\\\ backslash');
  });

  it('should show "none" for null search query', () => {
    const payload = createMockPayload();
    payload.inputProcessing.searchQuery = null;
    const result = buildMemoryInspectorView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('_none_');
  });
});

describe('buildTokenBudgetView', () => {
  it('should return a .txt file', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123');

    expect(result.files).toHaveLength(1);
    expect(result.files![0].name).toContain('token-budget');
    expect(result.files![0].name).toContain('.txt');
  });

  it('should include context window size', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('128,000');
  });

  it('should show history warning when > 70%', () => {
    const payload = createMockPayload();
    // 92000 / 128000 = 71.9%
    const result = buildTokenBudgetView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('>70%');
  });

  it('should show dropped counts', () => {
    const payload = createMockPayload();
    const result = buildTokenBudgetView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).toContain('1 memories');
    expect(content).toContain('5 history messages');
  });

  it('should not show dropped line when nothing dropped', () => {
    const payload = createMockPayload();
    payload.tokenBudget.memoriesDropped = 0;
    payload.tokenBudget.historyMessagesDropped = 0;
    const result = buildTokenBudgetView(payload, 'req-123');

    const content = result.files![0].attachment.toString();
    expect(content).not.toContain('Dropped:');
  });
});
