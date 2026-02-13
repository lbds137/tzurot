/**
 * Tests for inspect command handler orchestration
 *
 * Tests the main execute(), handleButton(), and handleSelectMenu()
 * handlers that wire together lookup, embed, components, and views.
 * Also tests access control: admin sees all, regular users see only their own logs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { DiagnosticPayload } from '@tzurot/common-types';
import { InspectCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock logger, config, and isBotOwner
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
    isBotOwner: (id: string) => id === 'owner-123',
  };
});

// Mock fetch
global.fetch = vi.fn();

function createMockDiagnosticPayload(): DiagnosticPayload {
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
  };
}

function createMockContext(
  identifier: string | null = 'test-req-123',
  userId = 'owner-123'
): DeferredCommandContext {
  const mockEditReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'identifier') return identifier;
          return null;
        }),
        getBoolean: vi.fn(() => null),
        getInteger: vi.fn(() => null),
      },
    },
    user: { id: userId },
    guild: null,
    member: null,
    channel: null,
    channelId: 'channel-123',
    guildId: null,
    commandName: 'inspect',
    isEphemeral: true,
    getOption: vi.fn((name: string) => {
      if (name === 'identifier') return identifier;
      return null;
    }),
    getRequiredOption: vi.fn(),
    getSubcommand: () => null,
    getSubcommandGroup: () => null,
    editReply: mockEditReply,
    followUp: vi.fn(),
    deleteReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

function createSuccessResponse(
  requestId: string,
  payload: DiagnosticPayload,
  userId = '123456789'
) {
  return new Response(
    JSON.stringify({
      log: {
        id: 'log-uuid',
        requestId,
        personalityId: 'personality-uuid',
        userId,
        guildId: '987654321',
        channelId: '111222333',
        model: 'test',
        provider: 'test',
        durationMs: 100,
        createdAt: '2026-01-22T12:00:00Z',
        data: payload,
      },
    }),
    { status: 200 }
  );
}

// Mock browse module
vi.mock('./browse.js', () => ({
  handleRecentBrowse: vi.fn().mockResolvedValue(undefined),
  handleBrowsePagination: vi.fn().mockResolvedValue(undefined),
  handleBrowseLogSelection: vi.fn().mockResolvedValue(undefined),
  isInspectBrowseInteraction: vi.fn((id: string) => id.includes('::browse::')),
  isInspectBrowseSelectInteraction: vi.fn((id: string) => id.includes('::browse-select::')),
}));

// Import the default export which contains execute, handleSelectMenu, handleButton
let inspectCommand: typeof import('./index.js').default;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('./index.js');
  inspectCommand = mod.default;
});
afterEach(() => vi.restoreAllMocks());

describe('execute (slash command)', () => {
  it('should dispatch to browse when identifier is null', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext(null);
    await inspectCommand.execute(context);

    expect(handleRecentBrowse).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should dispatch to browse when identifier is empty string', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext('');
    await inspectCommand.execute(context);

    expect(handleRecentBrowse).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should return embed with components on success', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const context = createMockContext('test-req-123');
    await inspectCommand.execute(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
        components: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should handle 404 errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const context = createMockContext('expired-req');
    await inspectCommand.execute(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Diagnostic log not found'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const context = createMockContext('test-req');
    await inspectCommand.execute(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error fetching diagnostic log'),
    });
  });

  it('should pass no filterUserId for admin users', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext(null, 'owner-123');
    await inspectCommand.execute(context);

    // Admin should pass undefined filterUserId
    expect(handleRecentBrowse).toHaveBeenCalledWith(context, undefined);
  });

  it('should pass filterUserId for non-admin users', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext(null, 'regular-user-456');
    await inspectCommand.execute(context);

    // Non-admin should pass their userId
    expect(handleRecentBrowse).toHaveBeenCalledWith(context, 'regular-user-456');
  });
});

describe('handleButton', () => {
  function createMockButtonInteraction(viewType: DebugViewType, userId = 'owner-123') {
    const requestId = 'test-req-123';
    return {
      customId: InspectCustomIds.button(requestId, viewType),
      user: { id: userId },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').ButtonInteraction;
  }

  it('should defer and respond with the requested view', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const interaction = createMockButtonInteraction(DebugViewType.FullJson);
    await inspectCommand.handleButton!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should handle expired logs gracefully', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const interaction = createMockButtonInteraction(DebugViewType.Reasoning);
    await inspectCommand.handleButton!(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Diagnostic log not found'),
    });
  });

  it('should return early for non-inspect custom IDs', async () => {
    const interaction = {
      customId: 'admin-settings::btn::foo',
      user: { id: 'owner-123' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    } as unknown as import('discord.js').ButtonInteraction;

    await inspectCommand.handleButton!(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('handleSelectMenu', () => {
  function createMockSelectInteraction(viewType: string, userId = 'owner-123') {
    const requestId = 'test-req-123';
    return {
      customId: InspectCustomIds.selectMenu(requestId),
      values: [viewType],
      user: { id: userId },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').StringSelectMenuInteraction;
  }

  it('should defer and respond with the selected view', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const interaction = createMockSelectInteraction(DebugViewType.TokenBudget);
    await inspectCommand.handleSelectMenu!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should reject unknown view types', async () => {
    const interaction = createMockSelectInteraction('invalid-view');
    await inspectCommand.handleSelectMenu!(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Unknown view type'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('should return early for non-inspect custom IDs', async () => {
    const interaction = {
      customId: 'admin-settings::select::foo',
      values: [DebugViewType.FullJson],
      user: { id: 'owner-123' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
    } as unknown as import('discord.js').StringSelectMenuInteraction;

    await inspectCommand.handleSelectMenu!(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
