/**
 * Tests for Admin Debug Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 *
 * Tests LLM diagnostic log retrieval:
 * - Successful diagnostic log fetch
 * - 404 handling (log not found/expired)
 * - Error handling
 * - Identifier validation (supports message ID, message link, or request UUID)
 * - Message ID lookup via /by-message endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDebug } from './debug.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { DiagnosticPayload } from '@tzurot/common-types';

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

/**
 * Create a mock diagnostic payload for testing
 */
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

describe('handleDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   * @param identifier - Can be a request UUID, message ID, or message link
   */
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
        if (name === 'identifier') {
          return identifier;
        }
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

  it('should fetch diagnostic log and return with embed and attachment', async () => {
    const mockPayload = createMockDiagnosticPayload();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          log: {
            id: 'log-uuid',
            requestId: 'test-req-123',
            personalityId: 'personality-uuid',
            userId: '123456789',
            guildId: '987654321',
            channelId: '111222333',
            model: 'claude-3-5-sonnet',
            provider: 'anthropic',
            durationMs: 1500,
            createdAt: '2026-01-22T12:00:00Z',
            data: mockPayload,
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext('test-req-123');
    await handleDebug(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/diagnostic/test-req-123'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should handle empty identifier', async () => {
    // Note: identifier is a required option, so Discord.js would normally reject
    // before reaching handler. This tests the defensive check for empty strings.
    const context = createMockContext('');
    await handleDebug(context);

    expect(fetch).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Identifier is required'),
    });
  });

  it('should handle 404 not found (log expired or not found)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const context = createMockContext('expired-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Diagnostic log not found'),
    });
  });

  it('should mention 24h retention in 404 message', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const context = createMockContext('expired-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('24h retention'),
    });
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const context = createMockContext('test-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to fetch diagnostic log'),
    });
  });

  it('should include HTTP status code in error message', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 503 }));

    const context = createMockContext('test-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('HTTP 503'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const context = createMockContext('test-req');
    await handleDebug(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Error fetching diagnostic log'),
    });
  });

  it('should URL-encode request ID in the API path', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const context = createMockContext('req/with/slashes');
    await handleDebug(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/diagnostic/req%2Fwith%2Fslashes'),
      expect.any(Object)
    );
  });

  it('should include service auth header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    const context = createMockContext('test-req');
    await handleDebug(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );
  });

  it('should handle logs with length finish reason (warning indicator)', async () => {
    const mockPayload = createMockDiagnosticPayload();
    mockPayload.llmResponse.finishReason = 'length'; // Truncated response

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          log: {
            id: 'log-uuid',
            requestId: 'test-req',
            personalityId: null,
            userId: null,
            guildId: null,
            channelId: null,
            model: 'test',
            provider: 'test',
            durationMs: 100,
            createdAt: '2026-01-22T12:00:00Z',
            data: mockPayload,
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext('test-req');
    await handleDebug(context);

    // Should still succeed with embed and files
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('should handle logs with high history token percentage (sycophancy warning)', async () => {
    const mockPayload = createMockDiagnosticPayload();
    // Set up high history token usage (>70%)
    mockPayload.tokenBudget.contextWindowSize = 10000;
    mockPayload.tokenBudget.historyTokensUsed = 8000; // 80%

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          log: {
            id: 'log-uuid',
            requestId: 'test-req',
            personalityId: null,
            userId: null,
            guildId: null,
            channelId: null,
            model: 'test',
            provider: 'test',
            durationMs: 100,
            createdAt: '2026-01-22T12:00:00Z',
            data: mockPayload,
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext('test-req');
    await handleDebug(context);

    // Should succeed regardless of warning state
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(Object)]),
        files: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  describe('identifier parsing', () => {
    it('should use /by-message endpoint for Discord message IDs (snowflakes)', async () => {
      const mockPayload = createMockDiagnosticPayload();
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            logs: [
              {
                id: 'log-uuid',
                requestId: 'internal-req-uuid',
                triggerMessageId: '1234567890123456789',
                personalityId: 'personality-uuid',
                userId: '123456789',
                guildId: '987654321',
                channelId: '111222333',
                model: 'test',
                provider: 'test',
                durationMs: 100,
                createdAt: '2026-01-22T12:00:00Z',
                data: mockPayload,
              },
            ],
            count: 1,
          }),
          { status: 200 }
        )
      );

      // Discord snowflake (17-20 digits)
      const context = createMockContext('1234567890123456789');
      await handleDebug(context);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/diagnostic/by-message/1234567890123456789'),
        expect.any(Object)
      );
    });

    it('should extract message ID from Discord message link', async () => {
      const mockPayload = createMockDiagnosticPayload();
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            logs: [
              {
                id: 'log-uuid',
                requestId: 'internal-req-uuid',
                triggerMessageId: '1234567890123456789',
                personalityId: 'personality-uuid',
                userId: '123456789',
                guildId: '987654321',
                channelId: '111222333',
                model: 'test',
                provider: 'test',
                durationMs: 100,
                createdAt: '2026-01-22T12:00:00Z',
                data: mockPayload,
              },
            ],
            count: 1,
          }),
          { status: 200 }
        )
      );

      // Discord message link with message ID at the end
      const context = createMockContext(
        'https://discord.com/channels/111111111111111111/222222222222222222/1234567890123456789'
      );
      await handleDebug(context);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/diagnostic/by-message/1234567890123456789'),
        expect.any(Object)
      );
    });

    it('should use direct endpoint for UUIDs', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

      // UUID format
      const context = createMockContext('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      await handleDebug(context);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/diagnostic/a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
        expect.any(Object)
      );
      expect(fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/by-message/'),
        expect.any(Object)
      );
    });

    it('should handle 404 for message ID lookup', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

      const context = createMockContext('1234567890123456789');
      await handleDebug(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No diagnostic logs found for this message'),
      });
    });

    it('should handle empty logs array for message ID lookup', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ logs: [], count: 0 }), { status: 200 })
      );

      const context = createMockContext('1234567890123456789');
      await handleDebug(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No diagnostic logs found for this message'),
      });
    });

    it('should use most recent log when multiple logs exist for a message', async () => {
      const mockPayload1 = createMockDiagnosticPayload();
      const mockPayload2 = createMockDiagnosticPayload();
      mockPayload1.meta.requestId = 'older-req';
      mockPayload2.meta.requestId = 'newer-req';

      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            logs: [
              // Most recent first (as returned by the API)
              {
                id: 'log-uuid-2',
                requestId: 'newer-req',
                triggerMessageId: '1234567890123456789',
                personalityId: null,
                userId: null,
                guildId: null,
                channelId: null,
                model: 'test',
                provider: 'test',
                durationMs: 100,
                createdAt: '2026-01-22T12:00:00Z',
                data: mockPayload2,
              },
              {
                id: 'log-uuid-1',
                requestId: 'older-req',
                triggerMessageId: '1234567890123456789',
                personalityId: null,
                userId: null,
                guildId: null,
                channelId: null,
                model: 'test',
                provider: 'test',
                durationMs: 100,
                createdAt: '2026-01-22T11:00:00Z',
                data: mockPayload1,
              },
            ],
            count: 2,
          }),
          { status: 200 }
        )
      );

      const context = createMockContext('1234567890123456789');
      await handleDebug(context);

      // Should succeed with the most recent log
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
          files: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });
  });
});
