/**
 * Tests for Profile Settings Handler
 * Tests gateway API calls for settings management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleShareLtmSetting } from './settings.js';
import { MessageFlags } from 'discord.js';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('handleShareLtmSetting', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(enabled: 'enable' | 'disable') {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required: boolean) => {
          if (name === 'enabled') return enabled;
          return null;
        },
      },
      reply: mockReply,
    } as any;
  }

  it('should show error when user has no account', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'User has no account yet',
    });

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when user has no profile', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'No default persona',
    });

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a profile"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show info message when already in desired state (enable)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        unchanged: true,
      },
    });

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already sharing'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show info message when already in desired state (disable)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        unchanged: true,
      },
    });

    await handleShareLtmSetting(createMockInteraction('disable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already keeping'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should enable LTM sharing', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        unchanged: false,
      },
    });

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/settings', {
      userId: '123456789',
      method: 'PATCH',
      body: {
        shareLtmAcrossPersonalities: true,
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('LTM sharing enabled'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should disable LTM sharing', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        unchanged: false,
      },
    });

    await handleShareLtmSetting(createMockInteraction('disable'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/settings', {
      userId: '123456789',
      method: 'PATCH',
      body: {
        shareLtmAcrossPersonalities: false,
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('LTM sharing disabled'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to update'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
