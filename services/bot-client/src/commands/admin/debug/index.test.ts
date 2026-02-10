/**
 * Tests for admin debug command handler orchestration
 *
 * Tests the main handleDebug, handleDebugButton, and handleDebugSelectMenu
 * handlers that wire together lookup, embed, components, and views.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { DiagnosticPayload } from '@tzurot/common-types';
import {
  handleDebug,
  handleDebugButton,
  handleDebugSelectMenu,
  isDebugInteraction,
} from './index.js';
import { DebugCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

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

function createMockContext(identifier: string | null = 'test-req-123'): DeferredCommandContext {
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
    user: { id: 'owner-123' },
    guild: null,
    member: null,
    channel: null,
    channelId: 'channel-123',
    guildId: null,
    commandName: 'admin',
    isEphemeral: true,
    getOption: vi.fn((name: string) => {
      if (name === 'identifier') return identifier;
      return null;
    }),
    getRequiredOption: vi.fn(),
    getSubcommand: () => 'debug',
    getSubcommandGroup: () => null,
    editReply: mockEditReply,
    followUp: vi.fn(),
    deleteReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

function createSuccessResponse(requestId: string, payload: DiagnosticPayload) {
  return new Response(
    JSON.stringify({
      log: {
        id: 'log-uuid',
        requestId,
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
    }),
    { status: 200 }
  );
}

// Mock browse module
vi.mock('./browse.js', () => ({
  handleRecentBrowse: vi.fn().mockResolvedValue(undefined),
}));

describe('handleDebug', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('should dispatch to browse when identifier is null', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext(null);
    await handleDebug(context);

    expect(handleRecentBrowse).toHaveBeenCalledWith(context);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should dispatch to browse when identifier is empty string', async () => {
    const { handleRecentBrowse } = await import('./browse.js');
    const context = createMockContext('');
    await handleDebug(context);

    expect(handleRecentBrowse).toHaveBeenCalledWith(context);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should return embed with components on success', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const context = createMockContext('test-req-123');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
        components: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should not return files by default', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const context = createMockContext('test-req-123');
    await handleDebug(context);

    const args = vi.mocked(context.editReply).mock.calls[0][0] as { files?: unknown[] };
    expect(args.files).toBeUndefined();
  });

  it('should handle 404 errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const context = createMockContext('expired-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Diagnostic log not found'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const context = createMockContext('test-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error fetching diagnostic log'),
    });
  });
});

describe('handleDebugButton', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function createMockButtonInteraction(viewType: DebugViewType) {
    const requestId = 'test-req-123';
    return {
      customId: DebugCustomIds.button(requestId, viewType),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').ButtonInteraction;
  }

  it('should defer and respond with the requested view', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const interaction = createMockButtonInteraction(DebugViewType.FullJson);
    await handleDebugButton(interaction);

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
    await handleDebugButton(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Diagnostic log not found'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const interaction = createMockButtonInteraction(DebugViewType.FullJson);
    await handleDebugButton(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Error loading debug view'),
    });
  });

  it('should return early for non-debug custom IDs', async () => {
    const interaction = {
      customId: 'admin-settings::btn::foo',
      deferReply: vi.fn(),
      editReply: vi.fn(),
    } as unknown as import('discord.js').ButtonInteraction;

    await handleDebugButton(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('handleDebugSelectMenu', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function createMockSelectInteraction(viewType: string) {
    const requestId = 'test-req-123';
    return {
      customId: DebugCustomIds.selectMenu(requestId),
      values: [viewType],
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('discord.js').StringSelectMenuInteraction;
  }

  it('should defer and respond with the selected view', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(createSuccessResponse('test-req-123', mockPayload));

    const interaction = createMockSelectInteraction(DebugViewType.TokenBudget);
    await handleDebugSelectMenu(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should reject unknown view types', async () => {
    const interaction = createMockSelectInteraction('invalid-view');
    await handleDebugSelectMenu(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Unknown view type'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('should return early for non-debug custom IDs', async () => {
    const interaction = {
      customId: 'admin-settings::select::foo',
      values: [DebugViewType.FullJson],
      deferReply: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
    } as unknown as import('discord.js').StringSelectMenuInteraction;

    await handleDebugSelectMenu(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('isDebugInteraction', () => {
  it('should return true for debug custom IDs', () => {
    expect(isDebugInteraction('admin-debug::btn::req::full-json')).toBe(true);
    expect(isDebugInteraction('admin-debug::select::req')).toBe(true);
  });

  it('should return false for other custom IDs', () => {
    expect(isDebugInteraction('admin-settings::btn::foo')).toBe(false);
  });
});
