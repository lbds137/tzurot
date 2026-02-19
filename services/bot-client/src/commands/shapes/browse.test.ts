/**
 * Tests for Shapes Browse Subcommand
 *
 * Browse shows initial page and returns. Pagination/selection
 * interactions are handled by interactionHandlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBrowse, buildBrowsePage, fetchShapesList, type ShapeItem } from './browse.js';
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

function makeShape(i: number): ShapeItem {
  return {
    id: `shape-${String(i)}`,
    name: `Shape ${String(i)}`,
    username: `shape-${String(i)}`,
    avatar: '',
    createdAt: new Date(2026, 0, i + 1).toISOString(),
  };
}

describe('handleBrowse', () => {
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
      getSubcommand: vi.fn().mockReturnValue('browse'),
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
    await handleBrowse(context);

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
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No shapes.inc credentials'),
    });
  });

  it('should display shapes in embed when found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        shapes: [makeShape(0), makeShape(1)],
        total: 2,
      },
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Characters'),
              description: expect.stringContaining('shape-0'),
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
    await handleBrowse(context);

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
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});

describe('buildBrowsePage', () => {
  const shapes = Array.from({ length: 15 }, (_, i) => makeShape(i));

  it('should build first page with select menu and pagination', () => {
    const { embed, components } = buildBrowsePage(shapes, 0, 'name');

    expect(embed.data.title).toContain('Characters');
    expect(embed.data.footer?.text).toContain('Page 1 of 2');

    // Select menu + pagination/sort row
    expect(components).toHaveLength(2);
  });

  it('should use shapes::browse custom ID prefix for components', () => {
    const { components } = buildBrowsePage(shapes, 0, 'name');

    // Select menu
    const selectMenu = components[0].components[0] as { data: { custom_id: string } };
    expect(selectMenu.data.custom_id).toMatch(/^shapes::browse-select::/);

    // Pagination buttons contain shapes::browse::
    const buttons = components[1].components as { data: { custom_id: string } }[];
    expect(buttons[0].data.custom_id).toMatch(/^shapes::browse::/);
  });

  it('should sort by name A-Z', () => {
    const unsorted: ShapeItem[] = [
      { id: '1', name: 'Zebra', username: 'zebra', avatar: '', createdAt: null },
      { id: '2', name: 'Alpha', username: 'alpha', avatar: '', createdAt: null },
    ];
    const { embed } = buildBrowsePage(unsorted, 0, 'name');

    const desc = embed.data.description ?? '';
    const alphaIdx = desc.indexOf('Alpha');
    const zebraIdx = desc.indexOf('Zebra');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('should sort by date newest first', () => {
    const items: ShapeItem[] = [
      { id: '1', name: 'Older', username: 'older', avatar: '', createdAt: '2026-01-01T00:00:00Z' },
      { id: '2', name: 'Newer', username: 'newer', avatar: '', createdAt: '2026-02-01T00:00:00Z' },
    ];
    const { embed } = buildBrowsePage(items, 0, 'date');

    const desc = embed.data.description ?? '';
    const newerIdx = desc.indexOf('Newer');
    const olderIdx = desc.indexOf('Older');
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it('should include sort toggle button', () => {
    const fewShapes = shapes.slice(0, 3);
    const { components } = buildBrowsePage(fewShapes, 0, 'name');

    // Should have select menu row + button row (with sort toggle even for single page)
    expect(components).toHaveLength(2);
    const buttons = components[1].components as { data: { label: string } }[];
    const sortButton = buttons.find(
      b => b.data.label === 'Sort by Date' || b.data.label === 'Sort A-Z'
    );
    expect(sortButton).toBeDefined();
  });
});

describe('fetchShapesList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return shapes on success', async () => {
    const mockShapes = [makeShape(0)];
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
