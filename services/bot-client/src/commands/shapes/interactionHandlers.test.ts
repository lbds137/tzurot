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

// Mock error sanitization
vi.mock('../../utils/errorSanitization.js', () => ({
  sanitizeErrorForDiscord: (msg: string) => msg,
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

  describe('import confirmation buttons', () => {
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

      const interaction = createMockButtonInteraction(
        'shapes::import-confirm::full',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/import',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ sourceSlug: 'test-slug', importType: 'full' }),
        })
      );
    });

    it('should handle import-confirm with memory_only', async () => {
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
        'shapes::import-confirm::memory_only',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/import',
        expect.objectContaining({
          body: expect.objectContaining({ importType: 'memory_only' }),
        })
      );
    });

    it('should show error on import-confirm with missing state', async () => {
      const interaction = createMockButtonInteraction('shapes::import-confirm::full');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Invalid import state'),
        })
      );
    });

    it('should show error on import-confirm with invalid importType', async () => {
      const interaction = createMockButtonInteraction(
        'shapes::import-confirm::invalid_type',
        'slug:test-slug'
      );
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

    it('should return to detail view on import-cancel from detail flow', async () => {
      // Detail view fetches import jobs + export jobs
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
        .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

      const interaction = createMockButtonInteraction(
        'shapes::import-cancel',
        'slug:test-slug::detail'
      );
      await handleShapesButton(interaction);

      // Should show detail view instead of generic cancel message
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.title).toContain('test-slug');
      expect(updateArgs.embeds[0].data.footer.text).toBe('slug:test-slug');
    });

    it('should NOT overwrite error with detail view when import fails from detail flow', async () => {
      // Import API returns 409 conflict
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: 'Import already in progress',
      });

      const interaction = createMockButtonInteraction(
        'shapes::import-confirm::full',
        'slug:test-slug::detail'
      );
      await handleShapesButton(interaction);

      // startImport calls update() for "Starting..." then editReply() for error
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockEditReply).toHaveBeenCalledTimes(1);
      // The error embed should be visible, NOT overwritten by detail view
      const editReplyArgs = mockEditReply.mock.calls[0][0];
      expect(editReplyArgs.embeds[0].data.title).toContain('Import Failed');
    });

    it('should show detail view after import from detail flow', async () => {
      // Import API call succeeds
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            importJobId: 'job-1',
            sourceSlug: 'test-slug',
            importType: 'full',
            status: 'pending',
          },
        })
        // Then detail view fetches import jobs + export jobs
        .mockResolvedValueOnce({
          ok: true,
          data: {
            jobs: [
              {
                id: 'job-1',
                sourceSlug: 'test-slug',
                status: 'pending',
                importType: 'full',
                memoriesImported: null,
                memoriesFailed: null,
                createdAt: '2026-01-15T00:00:00Z',
                completedAt: null,
                errorMessage: null,
                importMetadata: null,
              },
            ],
          },
        })
        .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

      // Footer with ::detail marker indicates from detail view
      const interaction = createMockButtonInteraction(
        'shapes::import-confirm::full',
        'slug:test-slug::detail'
      );
      await handleShapesButton(interaction);

      // Should have called editReply with detail view (after startImport's editReply)
      expect(mockEditReply).toHaveBeenCalled();
      const lastEditCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
      expect(lastEditCall.embeds[0].data.title).toContain('test-slug');
      expect(lastEditCall.embeds[0].data.footer.text).toBe('slug:test-slug');
    });
  });

  describe('detail view buttons', () => {
    it('should show import confirmation on detail-import', async () => {
      const interaction = createMockButtonInteraction(
        'shapes::detail-import::full',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.title).toContain('Import');
      // Footer should include ::detail marker for back-navigation
      expect(updateArgs.embeds[0].data.footer.text).toBe('slug:test-slug::detail');
      // Should have confirm + cancel buttons
      expect(updateArgs.components[0].components).toHaveLength(2);
    });

    it('should show memory-only import confirmation on detail-import::memory_only', async () => {
      const interaction = createMockButtonInteraction(
        'shapes::detail-import::memory_only',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.title).toContain('Memories');
    });

    it('should start export and show detail on detail-export', async () => {
      // Export API call succeeds
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            exportJobId: 'exp-1',
            sourceSlug: 'test-slug',
            format: 'json',
            status: 'pending',
          },
        })
        // Then detail view fetches import jobs + export jobs
        .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            jobs: [
              {
                id: 'exp-1',
                sourceSlug: 'test-slug',
                status: 'pending',
                format: 'json',
                fileName: null,
                fileSizeBytes: null,
                createdAt: '2026-02-16T00:00:00Z',
                completedAt: null,
                expiresAt: '2026-02-17T00:00:00Z',
                errorMessage: null,
                downloadUrl: null,
              },
            ],
          },
        });

      const interaction = createMockButtonInteraction(
        'shapes::detail-export::json',
        'slug:test-slug'
      );
      await handleShapesButton(interaction);

      // startExport calls update() then the handler calls editReply with detail view
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should show error on detail-import with missing slug', async () => {
      const interaction = createMockButtonInteraction('shapes::detail-import::full');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Invalid state'),
        })
      );
    });

    it('should refresh detail view on detail-refresh', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

      const interaction = createMockButtonInteraction('shapes::detail-refresh', 'slug:test-slug');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.title).toContain('test-slug');
    });

    it('should return to browse list on detail-back', async () => {
      const shapes = Array.from({ length: 3 }, (_, i) => ({
        id: `shape-${String(i)}`,
        name: `Shape ${String(i)}`,
        username: `shape-${String(i)}`,
        avatar: '',
        createdAt: null,
      }));

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes, total: shapes.length },
      });

      const interaction = createMockButtonInteraction('shapes::detail-back');
      await handleShapesButton(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/shapes/list', expect.anything());
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.title).toContain('Characters');
    });
  });

  describe('browse pagination buttons', () => {
    it('should re-fetch and show page on browse pagination', async () => {
      const shapes = Array.from({ length: 15 }, (_, i) => ({
        id: `shape-${String(i)}`,
        name: `Shape ${String(i)}`,
        username: `shape-${String(i)}`,
        avatar: '',
        createdAt: null,
      }));

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { shapes, total: shapes.length },
      });

      // Browse custom ID format: shapes::browse::page::filter::sort::query
      const interaction = createMockButtonInteraction('shapes::browse::1::all::name::');
      await handleShapesButton(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/shapes/list',
        expect.objectContaining({ userId: '123456789' })
      );
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateArgs = mockUpdate.mock.calls[0][0];
      expect(updateArgs.embeds[0].data.footer.text).toContain('Page 2 of 2');
    });

    it('should show auth error when session expired during pagination', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'No credentials',
      });

      const interaction = createMockButtonInteraction('shapes::browse::0::all::name::');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Session expired'),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should show error message when handler throws unexpectedly', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Unexpected'));

      const interaction = createMockButtonInteraction('shapes::browse::0::all::name::');
      await handleShapesButton(interaction);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('unexpected error'),
        })
      );
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

  it('should show detail view when shape is selected from browse', async () => {
    // Detail view fetches import jobs + export jobs
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    // Browse-select custom ID format: shapes::browse-select::page::filter::sort::query
    const interaction = createMockSelectInteraction('shapes::browse-select::0::all::name::', [
      'test-slug',
    ]);
    await handleShapesSelectMenu(interaction);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];

    // Should show detail embed with slug
    expect(updateArgs.embeds[0].data.title).toContain('test-slug');
    expect(updateArgs.embeds[0].data.footer.text).toBe('slug:test-slug');

    // Should have action buttons
    expect(updateArgs.components).toHaveLength(2);
    const row1Buttons = updateArgs.components[0].components;
    expect(row1Buttons[0].data.custom_id).toBe('shapes::detail-import::full');
  });

  it('should show error for unknown select menu action', async () => {
    const interaction = createMockSelectInteraction('shapes::unknown-action::0', ['test']);
    await handleShapesSelectMenu(interaction);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Unknown action'),
      })
    );
  });
});
