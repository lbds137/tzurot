/**
 * Tests for Shapes Export Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleExport } from './export.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { DEFERRED: 15000 },
}));

describe('handleExport', () => {
  const mockEditReply = vi.fn();
  const mockGetString = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetString.mockReturnValue('test-character');
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext(): DeferredCommandContext {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'shapes',
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('export'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      interaction: {
        options: { getString: mockGetString },
      },
    } as unknown as DeferredCommandContext;
  }

  it('should show progress message then call export endpoint', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        exportedAt: '2026-02-16T00:00:00.000Z',
        sourceSlug: 'test-character',
        config: { name: 'Test', username: 'test-character' },
        memories: [],
        stories: [],
        userPersonalization: null,
        stats: { memoriesCount: 0, storiesCount: 0, hasUserPersonalization: false },
      },
    });

    const context = createMockContext();
    await handleExport(context);

    // First call: progress embed
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Exporting'),
            }),
          }),
        ],
      })
    );

    // Gateway call
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/export',
      expect.objectContaining({
        method: 'POST',
        userId: '123456789',
        body: { slug: 'test-character' },
      })
    );
  });

  it('should send JSON file attachment on success', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        exportedAt: '2026-02-16T00:00:00.000Z',
        sourceSlug: 'test-character',
        config: { name: 'Test', username: 'test-character' },
        memories: [{ id: 'mem-1', result: 'test memory' }],
        stories: [],
        userPersonalization: null,
        stats: { memoriesCount: 1, storiesCount: 0, hasUserPersonalization: false },
      },
    });

    const context = createMockContext();
    await handleExport(context);

    // Second call should include files
    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.files).toBeDefined();
    expect(lastCall.files).toHaveLength(1);
    expect(lastCall.embeds[0].data.title).toContain('Export Complete');
  });

  it('should show auth prompt when no credentials', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'No credentials',
    });

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('No shapes.inc credentials');
  });

  it('should show not-found message for 404', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('not found');
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('unexpected error');
  });
});
