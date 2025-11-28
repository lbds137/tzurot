/**
 * Tests for Model Set-Default Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSetDefault } from './set-default.js';
import type { ChatInputCommandInteraction, User } from 'discord.js';
import { MessageFlags } from 'discord.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock the gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock command helpers
vi.mock('../../utils/commandHelpers.js', () => ({
  deferEphemeral: vi.fn().mockResolvedValue(undefined),
  replyWithError: vi.fn().mockResolvedValue(undefined),
  handleCommandError: vi.fn().mockResolvedValue(undefined),
}));

import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { deferEphemeral, replyWithError, handleCommandError } from '../../utils/commandHelpers.js';

describe('handleSetDefault', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      options: {
        getString: vi.fn(),
      },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-123');
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: true,
      data: {
        default: { configId: 'config-123', configName: 'Test Config' },
      },
    });

    await handleSetDefault(mockInteraction);

    expect(deferEphemeral).toHaveBeenCalledWith(mockInteraction);
  });

  it('should call API with correct parameters', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-456');
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: true,
      data: {
        default: { configId: 'config-456', configName: 'Test Config' },
      },
    });

    await handleSetDefault(mockInteraction);

    expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'PUT',
      userId: 'user-123',
      body: { configId: 'config-456' },
    });
  });

  it('should display success embed on successful update', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-123');
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: true,
      data: {
        default: { configId: 'config-123', configName: 'My Default Config' },
      },
    });

    await handleSetDefault(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Default Config Set'),
          }),
        }),
      ],
    });
  });

  it('should show error when API returns error', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-123');
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: false,
      error: 'Config not found',
      status: 404,
    });

    await handleSetDefault(mockInteraction);

    expect(replyWithError).toHaveBeenCalledWith(
      mockInteraction,
      'Failed to set default: Config not found'
    );
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-123');
    vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

    await handleSetDefault(mockInteraction);

    expect(handleCommandError).toHaveBeenCalledWith(mockInteraction, expect.any(Error), {
      userId: 'user-123',
      command: 'Model Set-Default',
    });
  });
});
