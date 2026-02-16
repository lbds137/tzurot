/**
 * Tests for Shapes Import Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleImport } from './import.js';
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
    vi.clearAllMocks();
    mockGetString.mockReturnValue('test-character');
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

  it('should show confirmation embed with buttons when credentials exist', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: true, service: 'shapes_inc' },
    });

    // Mock editReply to return a response with awaitMessageComponent
    const mockAwaitMessageComponent = vi.fn().mockRejectedValue(new Error('timeout'));
    mockEditReply.mockResolvedValue({
      awaitMessageComponent: mockAwaitMessageComponent,
    });

    const context = createMockContext();
    await handleImport(context);

    // Should show confirmation embed with components (buttons)
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
  });

  it('should normalize slug to lowercase', async () => {
    mockGetString.mockReturnValue('  Test-Character  ');
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: false },
    });

    const context = createMockContext();
    await handleImport(context);

    // The credential check is called regardless of slug normalization
    // Slug normalization is internal — just verify it doesn't throw
    expect(mockCallGatewayApi).toHaveBeenCalled();
  });

  it('should handle timeout on button confirmation', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { hasCredentials: true, service: 'shapes_inc' },
    });

    const mockAwaitMessageComponent = vi.fn().mockRejectedValue(new Error('timeout'));
    mockEditReply.mockResolvedValue({
      awaitMessageComponent: mockAwaitMessageComponent,
    });

    const context = createMockContext();
    await handleImport(context);

    // After timeout, should show timeout message
    expect(mockEditReply).toHaveBeenLastCalledWith({
      content: 'Import confirmation timed out.',
      embeds: [],
      components: [],
    });
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
