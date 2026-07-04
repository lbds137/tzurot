/**
 * Tests for Shapes Logout Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLogout } from './logout.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

describe('handleLogout', () => {
  const mockEditReply = vi.fn();
  let stub: { deleteShapesAuth: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { deleteShapesAuth: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(): DeferredCommandContext {
    return {
      interaction: { user: { id: '123456789', username: 'testuser' } },
      user: { id: '123456789', username: 'testuser' },
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

  it('should call userClient.deleteShapesAuth()', async () => {
    stub.deleteShapesAuth.mockResolvedValue(makeOk({ success: true }));

    const context = createMockContext();
    await handleLogout(context);

    expect(stub.deleteShapesAuth).toHaveBeenCalled();
  });

  it('should show success embed on successful removal', async () => {
    stub.deleteShapesAuth.mockResolvedValue(makeOk({ success: true }));

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
    stub.deleteShapesAuth.mockResolvedValue(makeErr(404, 'Not found'));

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have any"),
    });
  });

  it('should show error message for other failures', async () => {
    stub.deleteShapesAuth.mockResolvedValue(makeErr(500, 'Server error'));

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to remove'),
    });
  });

  it('should handle network errors gracefully', async () => {
    stub.deleteShapesAuth.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleLogout(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
