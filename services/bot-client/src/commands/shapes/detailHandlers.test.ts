/**
 * Tests for Shapes Detail View Handlers
 *
 * Tests the detail-specific button handlers extracted from interactionHandlers.ts:
 * import confirmation, export, refresh, cancel, and slug parsing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  parseSlugFromFooter,
  showDetailView,
  handleDetailImport,
  handleDetailExport,
  handleDetailRefresh,
  handleImportCancel,
  handleImportConfirm,
} from './detailHandlers.js';

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

const mockUpdate = vi.fn();
const mockEditReply = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
});

function createMockButtonInteraction(customId: string, embedFooter?: string): ButtonInteraction {
  return {
    customId,
    user: { id: '123456789' },
    update: mockUpdate,
    editReply: mockEditReply,
    message: {
      embeds: embedFooter !== undefined ? [{ footer: { text: embedFooter } }] : [],
    },
  } as unknown as ButtonInteraction;
}

describe('parseSlugFromFooter', () => {
  it('should parse slug from footer', () => {
    const interaction = createMockButtonInteraction('test', 'slug:my-shape');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBe('my-shape');
    expect(result.isFromDetail).toBe(false);
  });

  it('should detect ::detail marker', () => {
    const interaction = createMockButtonInteraction('test', 'slug:my-shape::detail');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBe('my-shape');
    expect(result.isFromDetail).toBe(true);
  });

  it('should return undefined for missing footer', () => {
    const interaction = createMockButtonInteraction('test');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBeUndefined();
    expect(result.isFromDetail).toBe(false);
  });

  it('should return undefined for invalid slug', () => {
    const interaction = createMockButtonInteraction('test', 'slug:-invalid');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBeUndefined();
  });

  it('should accept single-character slugs', () => {
    const interaction = createMockButtonInteraction('test', 'slug:a');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBe('a');
  });

  it('should accept two-character slugs', () => {
    const interaction = createMockButtonInteraction('test', 'slug:ab');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBe('ab');
  });

  it('should reject slugs starting with hyphen', () => {
    const interaction = createMockButtonInteraction('test', 'slug:-abc');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBeUndefined();
  });

  it('should reject slugs ending with hyphen', () => {
    const interaction = createMockButtonInteraction('test', 'slug:abc-');
    const result = parseSlugFromFooter(interaction);

    expect(result.slug).toBeUndefined();
  });
});

describe('showDetailView', () => {
  it('should fetch and display detail embed', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    const interaction = createMockButtonInteraction('test', 'slug:test-slug');
    await showDetailView(
      interaction as unknown as ButtonInteraction & StringSelectMenuInteraction,
      'test-slug'
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds[0].data.title).toContain('test-slug');
  });

  it('should clear content text to prevent bleed-through', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    const interaction = createMockButtonInteraction('test', 'slug:test-slug');
    await showDetailView(
      interaction as unknown as ButtonInteraction & StringSelectMenuInteraction,
      'test-slug'
    );

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.content).toBe('');
  });
});

describe('handleDetailImport', () => {
  it('should show confirmation embed with ::detail footer', async () => {
    const interaction = createMockButtonInteraction(
      'shapes::detail-import::full',
      'slug:test-slug'
    );
    await handleDetailImport(interaction, 'full');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds[0].data.footer.text).toBe('slug:test-slug::detail');
    expect(updateArgs.components[0].components).toHaveLength(2);
  });

  it('should show error when slug is missing', async () => {
    const interaction = createMockButtonInteraction('shapes::detail-import::full');
    await handleDetailImport(interaction, 'full');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Invalid state'),
      })
    );
  });
});

describe('handleDetailExport', () => {
  it('should start export and show detail view on success', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: { exportJobId: 'exp-1', sourceSlug: 'test-slug', format: 'json', status: 'pending' },
      })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    const interaction = createMockButtonInteraction(
      'shapes::detail-export::json',
      'slug:test-slug'
    );
    await handleDetailExport(interaction, 'json');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should show fallback message when detail refresh fails after successful export', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: { exportJobId: 'exp-1', sourceSlug: 'test-slug', format: 'json', status: 'pending' },
      })
      // buildShapeDetailEmbed's internal calls succeed (it catches errors internally)
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    // First editReply (detail view refresh) throws, triggering fallback
    mockEditReply
      .mockRejectedValueOnce(new Error('Discord API error'))
      .mockResolvedValueOnce(undefined);

    const interaction = createMockButtonInteraction(
      'shapes::detail-export::json',
      'slug:test-slug'
    );
    await handleDetailExport(interaction, 'json');

    // 2 editReply calls: failed detail refresh + successful fallback
    expect(mockEditReply).toHaveBeenCalledTimes(2);
    const fallbackArgs = mockEditReply.mock.calls[1][0];
    expect(fallbackArgs.content).toContain('Export started');
    expect(fallbackArgs.embeds).toEqual([]);
    expect(fallbackArgs.components).toEqual([]);
  });
});

describe('handleDetailRefresh', () => {
  it('should re-fetch and show detail view', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { jobs: [] } });

    const interaction = createMockButtonInteraction('shapes::detail-refresh', 'slug:test-slug');
    await handleDetailRefresh(interaction);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds[0].data.title).toContain('test-slug');
  });
});

describe('handleImportCancel', () => {
  it('should show generic cancel message when not from detail', async () => {
    const interaction = createMockButtonInteraction('shapes::import-cancel', 'slug:test-slug');
    await handleImportCancel(interaction);

    expect(mockUpdate).toHaveBeenCalledWith({
      content: 'Import cancelled.',
      embeds: [],
      components: [],
    });
  });

  it('should return to detail view when from detail flow', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } })
      .mockResolvedValueOnce({ ok: true, data: { jobs: [] } });

    const interaction = createMockButtonInteraction(
      'shapes::import-cancel',
      'slug:test-slug::detail'
    );
    await handleImportCancel(interaction);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds[0].data.title).toContain('test-slug');
  });
});

describe('handleImportConfirm', () => {
  it('should start import on valid state', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        importJobId: 'job-1',
        sourceSlug: 'test-slug',
        importType: 'full',
        status: 'pending',
      },
    });

    const interaction = createMockButtonInteraction(
      'shapes::import-confirm::full',
      'slug:test-slug'
    );
    await handleImportConfirm(interaction, {
      command: 'shapes',
      action: 'import-confirm',
      importType: 'full',
      exportFormat: undefined,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/import',
      expect.objectContaining({
        body: expect.objectContaining({ sourceSlug: 'test-slug', importType: 'full' }),
      })
    );
  });

  it('should NOT overwrite error with detail view when import fails', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Import already in progress',
    });

    const interaction = createMockButtonInteraction(
      'shapes::import-confirm::full',
      'slug:test-slug::detail'
    );
    await handleImportConfirm(interaction, {
      command: 'shapes',
      action: 'import-confirm',
      importType: 'full',
      exportFormat: undefined,
    });

    // startImport calls update() then editReply() for error — no detail view overwrite
    expect(mockEditReply).toHaveBeenCalledTimes(1);
    const editArgs = mockEditReply.mock.calls[0][0];
    expect(editArgs.embeds[0].data.title).toContain('Import Failed');
  });

  it('should show error on missing slug', async () => {
    const interaction = createMockButtonInteraction('shapes::import-confirm::full');
    await handleImportConfirm(interaction, {
      command: 'shapes',
      action: 'import-confirm',
      importType: 'full',
      exportFormat: undefined,
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Invalid import state'),
      })
    );
  });
});
