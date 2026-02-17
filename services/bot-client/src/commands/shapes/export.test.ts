/**
 * Tests for Shapes Export Subcommand (Async)
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

  it('should call async export endpoint and show confirmation', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        exportJobId: 'job-uuid-123',
        sourceSlug: 'test-character',
        format: 'json',
        status: 'pending',
        downloadUrl: 'https://gateway.example.com/exports/job-uuid-123',
      },
    });

    const context = createMockContext();
    await handleExport(context);

    // Should call POST endpoint with slug and format
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/export',
      expect.objectContaining({
        method: 'POST',
        userId: '123456789',
        body: { slug: 'test-character', format: 'json' },
      })
    );

    // Should show "Export Started" embed
    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.embeds[0].data.title).toContain('Export Started');
    expect(lastCall.embeds[0].data.description).toContain('/shapes status');
  });

  it('should show auth prompt when no credentials', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'No credentials',
    });

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('No shapes.inc credentials');
  });

  it('should show in-progress message for 409 conflict', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Already in progress',
    });

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('already in progress');
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleExport(context);

    const lastCall = mockEditReply.mock.calls[mockEditReply.mock.calls.length - 1][0];
    expect(lastCall.content).toContain('unexpected error');
  });
});
