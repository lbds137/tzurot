/**
 * Tests for inspect browse module
 *
 * Tests the browse UI for recent diagnostic logs:
 * - fetchRecentLogs — API call and parsing via UserClient
 * - buildBrowsePage — embed + components assembly (incl. empty state)
 * - handleRecentBrowse — slash command entry
 * - handleBrowsePagination — button navigation
 * - handleBrowseLogSelection — select menu drill-in
 * - isInspectBrowseInteraction / isInspectBrowseSelectInteraction — guards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import type {
  DiagnosticLogResponse,
  RecentDiagnosticLogsResponse,
} from '@tzurot/common-types/schemas/api/diagnostic';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { GatewayResult, UserClient } from '@tzurot/clients';
import {
  fetchRecentLogs,
  buildBrowsePage,
  handleRecentBrowse,
  handleBrowsePagination,
  handleBrowseLogSelection,
  isInspectBrowseInteraction,
  isInspectBrowseSelectInteraction,
} from './browse.js';
import type { DiagnosticLogSummary } from './types.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

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
  };
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

interface StubClient {
  getRecentDiagnostics: ReturnType<typeof vi.fn>;
  getDiagnosticByRequestId: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return {
    getRecentDiagnostics: vi.fn(),
    getDiagnosticByRequestId: vi.fn(),
  };
}

function asUserClient(stub: StubClient): UserClient {
  return stub as unknown as UserClient;
}

function makeRecentResponse(logs: DiagnosticLogSummary[]): RecentDiagnosticLogsResponse {
  // The schema requires a complete RecentDiagnosticLog shape; the local
  // DiagnosticLogSummary lacks no required fields, so the cast is safe
  // for testing purposes.
  return { logs: logs as never, count: logs.length };
}

describe('fetchRecentLogs', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should parse a successful response', async () => {
    const stub = createStubClient();
    const logs = [createMockLog()];
    stub.getRecentDiagnostics.mockResolvedValue(ok(makeRecentResponse(logs)));

    const result = await fetchRecentLogs(asUserClient(stub));

    expect(stub.getRecentDiagnostics).toHaveBeenCalledTimes(1);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].personalityName).toBe('Test Personality');
  });

  it('should throw on non-OK responses', async () => {
    const stub = createStubClient();
    stub.getRecentDiagnostics.mockResolvedValue(makeErr(500));

    await expect(fetchRecentLogs(asUserClient(stub))).rejects.toThrow(
      'Failed to fetch recent logs'
    );
  });

  it('should normalize Date createdAt to ISO string', async () => {
    const stub = createStubClient();
    // Cast to bypass the type-system enforcement that local
    // DiagnosticLogSummary.createdAt is `string` only — at runtime the
    // schema accepts `string | Date` and we need to verify the adapter.
    const logs = [createMockLog({ createdAt: new Date('2026-02-09T12:00:00Z') as never })];
    stub.getRecentDiagnostics.mockResolvedValue(ok(makeRecentResponse(logs)));

    const result = await fetchRecentLogs(asUserClient(stub));

    expect(typeof result.logs[0].createdAt).toBe('string');
    expect(result.logs[0].createdAt).toBe('2026-02-09T12:00:00.000Z');
  });
});

describe('buildBrowsePage', () => {
  it('should build page with embed and components for non-empty logs', () => {
    const logs = createMockLogs(15);
    const result = buildBrowsePage(logs, 0);

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].data.title).toBe('🔍 Diagnostic Logs');
    // §2.4 row grammar: bold personality name, model/time/duration metadata.
    expect(result.embeds[0].data.description).toContain('**1.** **Personality 0**');
    expect(result.embeds[0].data.description).toContain('└ `claude-3-5-sonnet`');
    // Select row + button row
    expect(result.components).toHaveLength(2);
  });

  it('should show empty state when no logs', () => {
    const result = buildBrowsePage([], 0);

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].data.description).toContain('No recent diagnostic logs');
    expect(result.embeds[0].data.description).toContain('24 hours');
    expect(result.components).toHaveLength(0);
  });

  it('should clamp page to valid range', () => {
    const logs = createMockLogs(5);
    const result = buildBrowsePage(logs, 99);

    // Should clamp to page 0 (only 1 page of 5 items): rows 1-5 render.
    expect(result.embeds[0].data.description).toContain('**1.**');
    expect(result.embeds[0].data.description).not.toContain('**6.**');
  });

  it('should handle null personalityName', () => {
    const logs = [createMockLog({ personalityName: null })];
    const result = buildBrowsePage(logs, 0);

    expect(result.embeds[0].data.description).toContain('Unknown');
  });
});

describe('handleRecentBrowse', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should show browse list on success', async () => {
    const stub = createStubClient();
    const logs = createMockLogs(3);
    stub.getRecentDiagnostics.mockResolvedValue(ok(makeRecentResponse(logs)));

    const editReply = vi.fn();
    const context = { editReply } as unknown as DeferredCommandContext;
    await handleRecentBrowse(context, asUserClient(stub));

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should show error on failure', async () => {
    const stub = createStubClient();
    stub.getRecentDiagnostics.mockRejectedValue(new Error('Network error'));

    const editReply = vi.fn();
    const context = { editReply } as unknown as DeferredCommandContext;
    await handleRecentBrowse(context, asUserClient(stub));

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error fetching recent diagnostic logs'),
    });
  });
});

describe('handleBrowsePagination', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should paginate on valid browse button', async () => {
    const stub = createStubClient();
    const logs = createMockLogs(15);
    stub.getRecentDiagnostics.mockResolvedValue(ok(makeRecentResponse(logs)));
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });

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
    expect(clientsForMock).not.toHaveBeenCalled();
  });
});

describe('handleBrowseLogSelection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should drill into selected log', async () => {
    const stub = createStubClient();
    const payload = createMockDiagnosticPayload();
    const log: DiagnosticLogResponse = {
      log: {
        id: 'log-uuid',
        requestId: 'req-uuid-0',
        triggerMessageId: null,
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
    };
    stub.getDiagnosticByRequestId.mockResolvedValue(ok(log));
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });

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
    const stub = createStubClient();
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });

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
