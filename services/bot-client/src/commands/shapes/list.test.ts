/**
 * Tests for Shapes List Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleList } from './list.js';
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

describe('handleList', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
      getSubcommand: vi.fn().mockReturnValue('list'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      interaction: {
        options: { getString: vi.fn() },
      },
    } as unknown as DeferredCommandContext;
  }

  it('should fetch shapes list from gateway', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { shapes: [], total: 0 },
    });
    mockEditReply.mockResolvedValue({
      createMessageComponentCollector: vi.fn().mockReturnValue({
        on: vi.fn(),
      }),
    });

    const context = createMockContext();
    await handleList(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/list',
      expect.objectContaining({ userId: '123456789' })
    );
  });

  it('should show auth prompt when no credentials', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'No credentials',
    });

    const context = createMockContext();
    await handleList(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No shapes.inc credentials'),
    });
  });

  it('should display shapes in embed when found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        shapes: [
          { id: 'shape-1', name: 'Test Shape', username: 'test-shape', avatar: '' },
          { id: 'shape-2', name: 'Another Shape', username: 'another', avatar: '' },
        ],
        total: 2,
      },
    });
    mockEditReply.mockResolvedValue({
      createMessageComponentCollector: vi.fn().mockReturnValue({
        on: vi.fn(),
      }),
    });

    const context = createMockContext();
    await handleList(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Characters'),
              description: expect.stringContaining('test-shape'),
            }),
          }),
        ],
      })
    );
  });

  it('should show empty message when no shapes', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { shapes: [], total: 0 },
    });
    mockEditReply.mockResolvedValue({
      createMessageComponentCollector: vi.fn().mockReturnValue({
        on: vi.fn(),
      }),
    });

    const context = createMockContext();
    await handleList(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('No shapes found'),
            }),
          }),
        ],
      })
    );
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleList(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
