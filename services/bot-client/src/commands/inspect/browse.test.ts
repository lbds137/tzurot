/**
 * Tests for inspect browse module
 *
 * Tests the browse UI for recent diagnostic logs:
 * - fetchRecentLogs — API call and parsing with userId filtering
 * - formatTimeAgo — relative time formatting
 * - buildBrowsePage — embed + components assembly
 * - buildEmptyBrowseEmbed — empty state
 * - handleRecentBrowse — slash command entry
 * - handleBrowsePagination — button navigation
 * - handleBrowseLogSelection — select menu drill-in
 * - isInspectBrowseInteraction / isInspectBrowseSelectInteraction — guards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DiagnosticPayload } from '@tzurot/common-types';
import {
  fetchRecentLogs,
  formatTimeAgo,
  buildBrowsePage,
  buildEmptyBrowseEmbed,
  handleRecentBrowse,
  handleBrowsePagination,
  handleBrowseLogSelection,
  isInspectBrowseInteraction,
  isInspectBrowseSelectInteraction,
} from './browse.js';
import type { DiagnosticLogSummary } from './types.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock logger and config
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    }),
  };
});

// Mock fetch
global.fetch = vi.fn();

function createMockLog(overrides: Partial<DiagnosticLogSummary> = {}): DiagnosticLogSummary {
  return {
    id: 'log-1',
    requestId: 'req-uuid-1',
    personalityId: 'personality-1',
    personalityName: 'Test Personality',
    userId: 'user-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    model: 'claude-3-5-sonnet',
    provider: 'anthropic',
    durationMs: 1500,
    createdAt: '2026-02-09T12:00:00Z',
    ...overrides,
  };
}

function createMockLogs(count: number): DiagnosticLogSummary[] {
  return Array.from({ length: count }, (_, i) =>
    createMockLog({
      id: `log-${i}`,
      requestId: `req-uuid-${i}`,
      personalityName: `Personality ${i}`,
      model: i % 2 === 0 ? 'claude-3-5-sonnet' : 'gpt-4',
      durationMs: 1000 + i * 100,
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
    })
  );
}

function createMockDiagnosticPayload(): DiagnosticPayload {
  return {
    meta: {
      requestId: 'req-uuid-0',
      personalityId: 'personality-1',
      personalityName: 'Test Personality',
      userId: '123456789',
      guildId: '987654321',
      channelId: '111222333',
      timestamp: '2026-02-09T12:00:00Z',
    },
    inputProcessing: {
      rawUserMessage: 'Hello',
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: 'hello',
    },
    memoryRetrieval: { memoriesFound: [], focusModeEnabled: false },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 500,
      memoryTokensUsed: 0,
      historyTokensUsed: 100,
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
  };
}

describe('formatTimeAgo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should format seconds ago', () => {
    vi.setSystemTime(new Date('2026-02-09T12:00:30Z'));
    expect(formatTimeAgo('2026-02-09T12:00:00Z')).toBe('30s ago');
  });

  it('should format minutes ago', () => {
    vi.setSystemTime(new Date('2026-02-09T12:05:00Z'));
    expect(formatTimeAgo('2026-02-09T12:00:00Z')).toBe('5m ago');
  });

  it('should format hours ago', () => {
    vi.setSystemTime(new Date('2026-02-09T15:00:00Z'));
    expect(formatTimeAgo('2026-02-09T12:00:00Z')).toBe('3h ago');
  });

  it('should format days ago', () => {
    vi.setSystemTime(new Date('2026-02-12T12:00:00Z'));
    expect(formatTimeAgo('2026-02-09T12:00:00Z')).toBe('3d ago');
  });

  it('should handle invalid date strings', () => {
    expect(formatTimeAgo('not-a-date')).toBe('unknown');
  });
});

describe('fetchRecentLogs', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should parse a successful response', async () => {
    const logs = [createMockLog()];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs, count: 1 }), { status: 200 })
    );

    const result = await fetchRecentLogs();

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].personalityName).toBe('Test Personality');
  });

  it('should throw on non-OK responses', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Server error', { status: 500 }));

    await expect(fetchRecentLogs()).rejects.toThrow('Failed to fetch recent logs');
  });

  it('should include userId query param when provided', async () => {
    const logs = [createMockLog()];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs, count: 1 }), { status: 200 })
    );

    await fetchRecentLogs('user-123');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('userId=user-123'),
      expect.any(Object)
    );
  });

  it('should not include userId param when not provided', async () => {
    const logs = [createMockLog()];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs, count: 1 }), { status: 200 })
    );

    await fetchRecentLogs();

    expect(fetch).toHaveBeenCalledWith(expect.not.stringContaining('userId='), expect.any(Object));
  });
});

describe('buildBrowsePage', () => {
  it('should build page with embed and components for non-empty logs', () => {
    const logs = createMockLogs(15);
    const result = buildBrowsePage(logs, 0);

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].data.title).toContain('Recent Diagnostic Logs');
    // Select row + button row
    expect(result.components).toHaveLength(2);
  });

  it('should show empty state when no logs', () => {
    const result = buildBrowsePage([], 0);

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].data.description).toContain('No recent diagnostic logs');
    expect(result.components).toHaveLength(0);
  });

  it('should clamp page to valid range', () => {
    const logs = createMockLogs(5);
    const result = buildBrowsePage(logs, 99);

    // Should clamp to page 0 (only 1 page of 5 items)
    expect(result.embeds[0].data.footer?.text).toContain('Page 1 of 1');
  });

  it('should handle null personalityName', () => {
    const logs = [createMockLog({ personalityName: null })];
    const result = buildBrowsePage(logs, 0);

    expect(result.embeds[0].data.description).toContain('Unknown');
  });
});

describe('buildEmptyBrowseEmbed', () => {
  it('should include retention note', () => {
    const embed = buildEmptyBrowseEmbed();
    expect(embed.data.description).toContain('24 hours');
  });
});

describe('handleRecentBrowse', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should show browse list on success', async () => {
    const logs = createMockLogs(3);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs, count: 3 }), { status: 200 })
    );

    const editReply = vi.fn();
    const context = { editReply } as unknown as DeferredCommandContext;
    await handleRecentBrowse(context);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should show error on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const editReply = vi.fn();
    const context = { editReply } as unknown as DeferredCommandContext;
    await handleRecentBrowse(context);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error fetching recent diagnostic logs'),
    });
  });
});

describe('handleBrowsePagination', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should paginate on valid browse button', async () => {
    const logs = createMockLogs(15);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ logs, count: 15 }), { status: 200 })
    );

    const interaction = {
      customId: 'inspect::browse::1::all::',
      user: { id: 'user-123' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').ButtonInteraction;

    await handleBrowsePagination(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });

  it('should return early for non-browse custom IDs', async () => {
    const interaction = {
      customId: 'admin-settings::btn::foo',
      user: { id: 'user-123' },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as import('discord.js').ButtonInteraction;

    await handleBrowsePagination(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });
});

describe('handleBrowseLogSelection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should drill into selected log', async () => {
    const payload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          log: {
            id: 'log-uuid',
            requestId: 'req-uuid-0',
            personalityId: 'p-1',
            userId: 'u-1',
            guildId: 'g-1',
            channelId: 'c-1',
            model: 'test',
            provider: 'test',
            durationMs: 100,
            createdAt: '2026-02-09T12:00:00Z',
            data: payload,
          },
        }),
        { status: 200 }
      )
    );

    const interaction = {
      customId: 'inspect::browse-select::0::all::',
      values: ['req-uuid-0'],
      user: { id: 'user-123' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').StringSelectMenuInteraction;

    await handleBrowseLogSelection(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
        components: expect.any(Array),
      })
    );

    // Verify there's a back button (3 rows: buttons, select, back)
    const callArgs = vi.mocked(interaction.editReply).mock.calls[0][0] as {
      components: unknown[];
    };
    expect(callArgs.components.length).toBe(3);
  });

  it('should show error when log not found', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const interaction = {
      customId: 'inspect::browse-select::0::all::',
      values: ['req-expired'],
      user: { id: 'user-123' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').StringSelectMenuInteraction;

    await handleBrowseLogSelection(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Diagnostic log not found'),
      })
    );
  });
});

describe('custom ID guards', () => {
  it('isInspectBrowseInteraction should match browse custom IDs', () => {
    expect(isInspectBrowseInteraction('inspect::browse::0::all::')).toBe(true);
    expect(isInspectBrowseInteraction('inspect::browse::1::all::')).toBe(true);
    expect(isInspectBrowseInteraction('inspect::browse-select::0::all::')).toBe(false);
    expect(isInspectBrowseInteraction('admin-settings::browse::0')).toBe(false);
  });

  it('isInspectBrowseSelectInteraction should match browse-select custom IDs', () => {
    expect(isInspectBrowseSelectInteraction('inspect::browse-select::0::all::')).toBe(true);
    expect(isInspectBrowseSelectInteraction('inspect::browse::0::all::')).toBe(false);
    expect(isInspectBrowseSelectInteraction('admin-settings::browse-select::0')).toBe(false);
  });
});
