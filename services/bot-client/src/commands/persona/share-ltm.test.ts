/**
 * Tests for Persona Settings Handler
 * Tests gateway API calls for settings management.
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleShareLtmSetting } from './share-ltm.js';
import { mockUpdatePersonaSettingsResponse } from '@tzurot/common-types';

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
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(enabled: 'enable' | 'disable') {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string, _required: boolean) => {
            if (name === 'enabled') return enabled;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleShareLtmSetting>[0];
  }

  it('should show error when user has no account', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'User has no account yet',
    });

    await handleShareLtmSetting(createMockContext('enable'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account"),
    });
  });

  it('should show error when user has no persona', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'No default persona',
    });

    await handleShareLtmSetting(createMockContext('enable'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a persona"),
    });
  });

  it('should show info message when already in desired state (enable)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaSettingsResponse({ unchanged: true }),
    });

    await handleShareLtmSetting(createMockContext('enable'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already sharing'),
    });
  });

  it('should show info message when already in desired state (disable)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaSettingsResponse({ unchanged: true }),
    });

    await handleShareLtmSetting(createMockContext('disable'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already keeping'),
    });
  });

  it('should enable LTM sharing', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaSettingsResponse({ unchanged: false }),
    });

    await handleShareLtmSetting(createMockContext('enable'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/settings', {
      userId: '123456789',
      method: 'PATCH',
      body: {
        shareLtmAcrossPersonalities: true,
      },
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('LTM sharing enabled'),
    });
  });

  it('should disable LTM sharing', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaSettingsResponse({ unchanged: false }),
    });

    await handleShareLtmSetting(createMockContext('disable'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/settings', {
      userId: '123456789',
      method: 'PATCH',
      body: {
        shareLtmAcrossPersonalities: false,
      },
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('LTM sharing disabled'),
    });
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleShareLtmSetting(createMockContext('enable'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to update'),
    });
  });
});
