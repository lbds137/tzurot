/**
 * Tests for Shapes List Subcommand
 *
 * List now shows initial page and returns. Pagination/selection
 * interactions are handled by interactionHandlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleList, buildListPage, fetchShapesList } from './list.js';
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
    vi.resetAllMocks();
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

describe('buildListPage', () => {
  const shapes = Array.from({ length: 15 }, (_, i) => ({
    id: `shape-${String(i)}`,
    name: `Shape ${String(i)}`,
    username: `shape-${String(i)}`,
    avatar: '',
  }));

  it('should build first page with select menu and pagination', () => {
    const { embed, components } = buildListPage(shapes, 0);

    expect(embed.data.title).toContain('Characters');
    expect(embed.data.description).toContain('shape-0');
    expect(embed.data.footer?.text).toContain('Page 1 of 2');

    // Select menu + pagination row
    expect(components).toHaveLength(2);
  });

  it('should use shapes:: custom ID prefix for all components', () => {
    const { components } = buildListPage(shapes, 0);

    // Select menu (cast to access custom_id — union type includes SKU buttons without it)
    const selectMenu = components[0].components[0] as { data: { custom_id: string } };
    expect(selectMenu.data.custom_id).toMatch(/^shapes::list-select::/);

    // Pagination buttons
    const buttons = components[1].components as { data: { custom_id: string } }[];
    expect(buttons[0].data.custom_id).toMatch(/^shapes::list-prev::/);
    expect(buttons[1].data.custom_id).toBe('shapes::list-info');
    expect(buttons[2].data.custom_id).toMatch(/^shapes::list-next::/);
  });

  it('should not show pagination for single page', () => {
    const fewShapes = shapes.slice(0, 3);
    const { components } = buildListPage(fewShapes, 0);

    // Only select menu, no pagination row
    expect(components).toHaveLength(1);
  });
});

describe('fetchShapesList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return shapes on success', async () => {
    const mockShapes = [{ id: '1', name: 'Test', username: 'test', avatar: '' }];
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { shapes: mockShapes, total: 1 },
    });

    const result = await fetchShapesList('user-123');

    expect(result).toEqual({ ok: true, shapes: mockShapes });
  });

  it('should return error on failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'No credentials',
    });

    const result = await fetchShapesList('user-123');

    expect(result).toEqual({ ok: false, status: 401, error: 'No credentials' });
  });
});
