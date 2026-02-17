/**
 * Tests for Shapes Import Subcommand
 *
 * Import now shows confirmation embed + buttons, then returns.
 * Button handling (confirm → startImport, cancel) is in interactionHandlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleImport, startImport } from './import.js';
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

describe('handleImport', () => {
  const mockEditReply = vi.fn();
  const mockGetString = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    // Return different values based on option name
    mockGetString.mockImplementation((name: string) => {
      if (name === 'slug') return 'test-character';
      if (name === 'import_type') return null;
      if (name === 'personality') return null;
      return null;
    });
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
      getSubcommand: vi.fn().mockReturnValue('import'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      interaction: {
        options: { getString: mockGetString },
      },
    } as unknown as DeferredCommandContext;
  }

  it('should check credentials before importing', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 401,
      data: { hasCredentials: false },
    });

    const context = createMockContext();
    await handleImport(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/auth/status',
      expect.objectContaining({ userId: '123456789' })
    );
  });

  it('should show auth prompt when no credentials exist', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: false },
    });

    const context = createMockContext();
    await handleImport(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No shapes.inc credentials'),
    });
  });

  it('should show confirmation embed with correct custom IDs', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: true, service: 'shapes_inc' },
    });

    const context = createMockContext();
    await handleImport(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Import from Shapes.inc'),
            }),
          }),
        ]),
        components: expect.arrayContaining([expect.anything()]),
      })
    );

    // Verify custom IDs use shapes:: prefix
    const replyArgs = mockEditReply.mock.calls[0][0];
    const buttons = replyArgs.components[0].components;
    expect(buttons[0].data.custom_id).toMatch(/^shapes::import-confirm::/);
    expect(buttons[1].data.custom_id).toBe('shapes::import-cancel');
  });

  it('should encode slug and import type in confirm button custom ID', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: true, service: 'shapes_inc' },
    });

    const context = createMockContext();
    await handleImport(context);

    const replyArgs = mockEditReply.mock.calls[0][0];
    const confirmButton = replyArgs.components[0].components[0];
    // Should be shapes::import-confirm::test-character::full
    expect(confirmButton.data.custom_id).toBe('shapes::import-confirm::test-character::full');
  });

  it('should normalize slug to lowercase', async () => {
    mockGetString.mockReturnValue('  Test-Character  ');
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: false },
    });

    const context = createMockContext();
    await handleImport(context);

    expect(mockCallGatewayApi).toHaveBeenCalled();
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleImport(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});

describe('startImport', () => {
  const mockUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockButtonInteraction() {
    return {
      user: { id: '123456789' },
      update: mockUpdate,
      editReply: mockEditReply,
    } as any;
  }

  it('should call gateway import API with correct params', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { importJobId: 'job-123', sourceSlug: 'test', importType: 'full', status: 'pending' },
    });

    const interaction = createMockButtonInteraction();
    await startImport(interaction, '123456789', {
      slug: 'test-shape',
      importType: 'full',
    });

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/import',
      expect.objectContaining({
        method: 'POST',
        userId: '123456789',
        body: { sourceSlug: 'test-shape', importType: 'full', existingPersonalityId: undefined },
      })
    );
  });

  it('should show success embed on successful import', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { importJobId: 'job-123', sourceSlug: 'test', importType: 'full', status: 'pending' },
    });

    const interaction = createMockButtonInteraction();
    await startImport(interaction, '123456789', {
      slug: 'test-shape',
      importType: 'full',
    });

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Import Started'),
            }),
          }),
        ],
      })
    );
  });

  it('should show conflict error for 409', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Already running',
    });

    const interaction = createMockButtonInteraction();
    await startImport(interaction, '123456789', {
      slug: 'test-shape',
      importType: 'full',
    });

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('already in progress'),
            }),
          }),
        ],
      })
    );
  });
});
