/**
 * Tests for inspect command handler orchestration
 *
 * Tests the main execute(), handleButton(), and handleSelectMenu()
 * handlers that wire together lookup, embed, components, and views.
 * Also tests access control: admin sees all, regular users see only their own logs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import { MessageFlags } from 'discord.js';
import type { DiagnosticLogResponse } from '@tzurot/common-types/schemas/api/diagnostic';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { GatewayResult, UserClient } from '@tzurot/clients';
import { InspectCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';
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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (id: string) => id === 'owner-123',
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

interface StubClient {
  getRecentDiagnostics: ReturnType<typeof vi.fn>;
  getDiagnosticByMessage: ReturnType<typeof vi.fn>;
  getDiagnosticByResponse: ReturnType<typeof vi.fn>;
  getDiagnosticByRequestId: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return {
    getRecentDiagnostics: vi.fn(),
    getDiagnosticByMessage: vi.fn(),
    getDiagnosticByResponse: vi.fn(),
    getDiagnosticByRequestId: vi.fn(),
  };
}

function asUserClient(stub: StubClient): UserClient {
  return stub as unknown as UserClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

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

function createSuccessResponse(
  requestId: string,
  payload: DiagnosticPayload
): GatewayResult<DiagnosticLogResponse> {
  return ok({
    log: {
      id: 'log-uuid',
      requestId,
      triggerMessageId: null,
      personalityId: 'personality-uuid',
      userId: '123456789',
      guildId: '987654321',
      channelId: '111222333',
      model: 'test',
      provider: 'test',
      durationMs: 100,
      createdAt: '2026-01-22T12:00:00Z',
      data: payload,
    },
  });
}

function createMockContext(
  identifier: string | null = 'test-req-123',
  userId = 'owner-123'
): DeferredCommandContext {
  const mockEditReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      user: { id: userId },
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
let stub: StubClient;

beforeEach(async () => {
  vi.clearAllMocks();
  stub = createStubClient();
  clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
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
    expect(stub.getDiagnosticByRequestId).not.toHaveBeenCalled();
  });

  it('should dispatch to browse when identifier is empty string', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext('');
    await inspectCommand.execute(context);

    expect(handleRecentBrowse).toHaveBeenCalled();
    expect(stub.getDiagnosticByRequestId).not.toHaveBeenCalled();
  });

  it('should return embed with components on success', async () => {
    const mockPayload = createMockDiagnosticPayload();
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

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
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));

    const context = createMockContext('expired-req');
    await inspectCommand.execute(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Diagnostic log not found'),
    });
  });

  it('should handle network errors', async () => {
    stub.getDiagnosticByRequestId.mockRejectedValue(new Error('Network error'));

    const context = createMockContext('test-req');
    await inspectCommand.execute(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error fetching diagnostic log'),
    });
  });

  it('should pass the bound userClient through to handleRecentBrowse', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext(null, 'owner-123');
    await inspectCommand.execute(context);

    // Server-side filtering means the bot-client passes the bound userClient
    // through unchanged regardless of owner status; the gateway decides what
    // to filter based on the X-User-Id header on the bound client.
    expect(handleRecentBrowse).toHaveBeenCalledWith(context, asUserClient(stub));
  });

  it('should pass the bound userClient through for non-owner callers', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext(null, 'regular-user-456');
    await inspectCommand.execute(context);

    expect(handleRecentBrowse).toHaveBeenCalledWith(context, asUserClient(stub));
  });
});

describe('handleButton', () => {
  function createMockButtonInteraction(viewType: DebugViewType, userId = 'owner-123') {
    const requestId = 'test-req-123';
    return {
      customId: InspectCustomIds.button(requestId, viewType),
      user: { id: userId },
      deferReply: vi.fn().mockResolvedValue(undefined),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').ButtonInteraction;
  }

  function createMockMemoryButtonInteraction(userId = 'owner-123') {
    const requestId = 'test-req-123';
    return {
      customId: InspectCustomIds.memoryButton(requestId, 'included', 5, 'score-asc'),
      user: { id: userId },
      deferReply: vi.fn().mockResolvedValue(undefined),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').ButtonInteraction;
  }

  it('should defer and respond with the requested view', async () => {
    const mockPayload = createMockDiagnosticPayload();
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

    const interaction = createMockButtonInteraction(DebugViewType.FullJson);
    await inspectCommand.handleButton!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('routes chunkedText views through the chunked-reply path (button dispatch)', async () => {
    // renderViewResult is shared with handleSelectMenu, but this pins the
    // BUTTON path's wiring through sendChunkedReply — Reasoning is reachable
    // via the button row, and long reasoning follows up past the first chunk.
    const mockPayload = createMockDiagnosticPayload();
    mockPayload.postProcessing.thinkingContent = 'z'.repeat(2500);
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

    const interaction = createMockButtonInteraction(DebugViewType.Reasoning);
    await inspectCommand.handleButton!(interaction);

    const editArg = vi.mocked(interaction.editReply).mock.calls[0][0] as {
      content?: string;
      files?: unknown;
    };
    expect(editArg.content).toContain('## Reasoning');
    expect(editArg.files).toBeUndefined();
    // 2500 chars splits past one message — the tail arrives as a follow-up
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('reasoning continued') })
    );
  });

  it('should handle expired logs gracefully', async () => {
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));

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

  it('uses deferUpdate (not deferReply) for memory-state filter buttons', async () => {
    // deferUpdate edits the existing ephemeral message in place, so successive
    // filter clicks don't accumulate as separate messages in the user's view.
    const mockPayload = createMockDiagnosticPayload();
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

    const interaction = createMockMemoryButtonInteraction();
    await inspectCommand.handleButton!(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('uses deferReply for non-memory view-navigation buttons', async () => {
    const mockPayload = createMockDiagnosticPayload();
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

    const interaction = createMockButtonInteraction(DebugViewType.FullJson);
    await inspectCommand.handleButton!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('dispatches browse-pagination buttons to handleBrowsePagination', async () => {
    const { handleBrowsePagination } = await import('./browse.js');
    const interaction = {
      // customId matches the `::browse::` substring the mocked isInspectBrowseInteraction checks for
      customId: 'inspect::browse::1::all::',
      user: { id: 'regular-user-456' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').ButtonInteraction;

    await inspectCommand.handleButton!(interaction);

    expect(handleBrowsePagination).toHaveBeenCalledWith(interaction);
  });
});

describe('handleSelectMenu', () => {
  function createMockSelectInteraction(viewType: string, userId = 'owner-123') {
    const requestId = 'test-req-123';
    const interaction: Record<string, unknown> = {
      customId: InspectCustomIds.selectMenu(requestId),
      values: [viewType],
      user: { id: userId },
      deferred: false,
      replied: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    // deferReply flips the ack state like Discord, so replyError picks editReply
    // (deferred) over reply (fresh) — matching the runtime path for error replies.
    interaction.deferReply = vi.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    });
    return interaction as unknown as import('discord.js').StringSelectMenuInteraction;
  }

  it('should defer and respond with the selected view', async () => {
    const mockPayload = createMockDiagnosticPayload();
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

    const interaction = createMockSelectInteraction(DebugViewType.TokenBudget);
    await inspectCommand.handleSelectMenu!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('routes chunkedText views through the chunked-reply path', async () => {
    const mockPayload = createMockDiagnosticPayload();
    mockPayload.postProcessing.thinkingContent = 'Short reasoning body';
    stub.getDiagnosticByRequestId.mockResolvedValue(
      createSuccessResponse('test-req-123', mockPayload)
    );

    const interaction = createMockSelectInteraction(DebugViewType.Reasoning);
    await inspectCommand.handleSelectMenu!(interaction);

    // Single chunk: sendChunkedReply edits the deferred reply with inline text,
    // never a file attachment.
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Short reasoning body'),
      })
    );
    const editArg = (interaction.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      files?: unknown;
    };
    expect(editArg.files).toBeUndefined();
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

  it('surfaces a lookup failure through replyError on the deferred slot', async () => {
    // After deferReply, replyError must take the editReply (deferred) path —
    // a fresh reply() here would throw at runtime (interaction already acked).
    stub.getDiagnosticByRequestId.mockResolvedValue(makeErr(404));

    const interaction = createMockSelectInteraction(DebugViewType.TokenBudget);
    await inspectCommand.handleSelectMenu!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('not found'),
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('surfaces a thrown gateway error through replyError in the catch path', async () => {
    stub.getDiagnosticByRequestId.mockRejectedValue(new Error('gateway exploded'));

    const interaction = createMockSelectInteraction(DebugViewType.TokenBudget);
    await inspectCommand.handleSelectMenu!(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error loading diagnostic view'),
    });
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

  it('dispatches browse-select interactions to handleBrowseLogSelection', async () => {
    const { handleBrowseLogSelection } = await import('./browse.js');
    const interaction = {
      // customId matches the `::browse-select::` substring the mocked isInspectBrowseSelectInteraction checks for
      customId: 'inspect::browse-select::0',
      values: ['req-from-list'],
      user: { id: 'regular-user-456' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').StringSelectMenuInteraction;

    await inspectCommand.handleSelectMenu!(interaction);

    expect(handleBrowseLogSelection).toHaveBeenCalledWith(interaction);
  });
});
