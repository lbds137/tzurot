/**
 * Tests for Shapes Logout Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLogout } from './logout.js';
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

describe('handleLogout', () => {
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
      getSubcommand: vi.fn().mockReturnValue('logout'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as DeferredCommandContext;
  }

  it('should call gateway DELETE endpoint', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true });

    const context = createMockContext();
    await handleLogout(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/shapes/auth',
      expect.objectContaining({
        method: 'DELETE',
        userId: '123456789',
      })
    );
  });

  it('should show success embed on successful removal', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true });

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Credentials Removed'),
          }),
        }),
      ],
    });
  });

  it('should show not-found message for 404', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have any"),
    });
  });

  it('should show error message for other failures', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to remove'),
    });
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
