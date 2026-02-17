/**
 * Tests for Shapes Interaction Handlers
 *
 * Tests the central router for all shapes button and select menu interactions.
 * These handlers are exported from shapes/index.ts and routed through CommandHandler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { handleShapesButton, handleShapesSelectMenu } from './interactionHandlers.js';

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

describe('handleShapesButton', () => {
  const mockUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockShowModal = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockButtonInteraction(customId: string, embedFooter?: string): ButtonInteraction {
    return {
      customId,
      user: { id: '123456789' },
      update: mockUpdate,
      editReply: mockEditReply,
      showModal: mockShowModal,
      message: {
        embeds: embedFooter !== undefined ? [{ footer: { text: embedFooter } }] : [],
      },
    } as unknown as ButtonInteraction;
  }

  describe('auth buttons', () => {
    it('should show modal on auth-continue', async () => {
      const interaction = createMockButtonInteraction('shapes::auth-continue');
      await handleShapesButton(interaction);

      expect(mockShowModal).toHaveBeenCalledTimes(1);
      const modal = mockShowModal.mock.calls[0][0];
      expect(modal.data.custom_id).toBe('shapes::auth');
      expect(modal.data.title).toBe('Shapes.inc Authentication');
    });

    it('should show cancellation message on auth-cancel', async () => {
      const interaction = createMockButtonInteraction('shapes::auth-cancel');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith({
        content: 'Authentication cancelled.',
        embeds: [],
        components: [],
      });
    });
  });

  describe('import buttons', () => {
    it('should start import on import-confirm with valid state', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          importJobId: 'job-123',
          sourceSlug: 'test-slug',
          importType: 'full',
          status: 'pending',
        },
      });

      // Slug is in the embed footer, not the custom ID
      const interaction = createMockButtonInteraction(
        'shapes::import-confirm::full',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      // Should have called update (starting) then editReply (success)
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/import',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ sourceSlug: 'test-slug', importType: 'full' }),
        })
      );
    });

    it('should handle import-confirm with memory_only and personalityId', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          importJobId: 'job-456',
          sourceSlug: 'test-slug',
          importType: 'memory_only',
          status: 'pending',
        },
      });

      const interaction = createMockButtonInteraction(
        'shapes::import-confirm::memory_only::personality-uuid',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/import',
        expect.objectContaining({
          body: expect.objectContaining({
            importType: 'memory_only',
            existingPersonalityId: 'personality-uuid',
          }),
        })
      );
    });

    it('should show error on import-confirm with missing state', async () => {
      // No embed footer = no slug
      const interaction = createMockButtonInteraction('shapes::import-confirm::full');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Invalid import state'),
        })
      );
    });

    it('should show cancellation message on import-cancel', async () => {
      const interaction = createMockButtonInteraction('shapes::import-cancel');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith({
        content: 'Import cancelled.',
        embeds: [],
        components: [],
      });
    });
  });

  describe('list pagination buttons', () => {
    it('should re-fetch and show previous page on list-prev', async () => {
      const shapes = Array.from({ length: 15 }, (_, i) => ({
        id: `shape-${String(i)}`,
        name: `Shape ${String(i)}`,
        username: `shape-${String(i)}`,
        avatar: '',
      }));

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes, total: shapes.length },
      });

      const interaction = createMockButtonInteraction('shapes::list-prev::1');
      await handleShapesButton(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/list',
        expect.objectContaining({ userId: '123456789' })
      );
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      // Should show page 0 (1 - 1)
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.footer.text).toContain('Page 1 of 2');
    });

    it('should re-fetch and show next page on list-next', async () => {
      const shapes = Array.from({ length: 15 }, (_, i) => ({
        id: `shape-${String(i)}`,
        name: `Shape ${String(i)}`,
        username: `shape-${String(i)}`,
        avatar: '',
      }));

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes, total: shapes.length },
      });

      const interaction = createMockButtonInteraction('shapes::list-next::0');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      // Should show page 1 (0 + 1)
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.footer.text).toContain('Page 2 of 2');
    });

    it('should show auth error when session expired during pagination', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'No credentials',
      });

      const interaction = createMockButtonInteraction('shapes::list-prev::1');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Session expired'),
        })
      );
    });
  });

  describe('action buttons', () => {
    it('should show import hint on action-import', async () => {
      const interaction = createMockButtonInteraction('shapes::action-import::test-slug');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining('/shapes import slug:test-slug'),
              }),
            }),
          ],
          components: [],
        })
      );
    });

    it('should show export hint on action-export', async () => {
      const interaction = createMockButtonInteraction('shapes::action-export::my-shape');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining('/shapes export slug:my-shape'),
              }),
            }),
          ],
        })
      );
    });

    it('should re-fetch list and show page 0 on action-back', async () => {
      const shapes = Array.from({ length: 15 }, (_, i) => ({
        id: `shape-${String(i)}`,
        name: `Shape ${String(i)}`,
        username: `shape-${String(i)}`,
        avatar: '',
      }));

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes, total: shapes.length },
      });

      const interaction = createMockButtonInteraction('shapes::action-back');
      await handleShapesButton(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/shapes/list', expect.anything());
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      // Should always return to page 0 regardless of previous page
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.footer.text).toContain('Page 1 of 2');
    });
  });
});

describe('handleShapesSelectMenu', () => {
  const mockUpdate = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockSelectInteraction(
    customId: string,
    values: string[]
  ): StringSelectMenuInteraction {
    return {
      customId,
      values,
      user: { id: '123456789' },
      update: mockUpdate,
    } as unknown as StringSelectMenuInteraction;
  }

  it('should show action buttons when shape is selected', async () => {
    const interaction = createMockSelectInteraction('shapes::list-select::0', ['test-slug']);
    await handleShapesSelectMenu(interaction);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];

    // Should show shape name in embed
    expect(updateArgs.embeds[0].data.title).toContain('test-slug');

    // Should have import, export, back buttons
    const buttons = updateArgs.components[0].components;
    expect(buttons).toHaveLength(3);
    expect(buttons[0].data.custom_id).toBe('shapes::action-import::test-slug');
    expect(buttons[1].data.custom_id).toBe('shapes::action-export::test-slug');
    expect(buttons[2].data.custom_id).toBe('shapes::action-back');
  });
});
