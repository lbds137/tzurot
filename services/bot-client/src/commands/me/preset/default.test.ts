/**
 * Tests for Preset Default Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSetDefault } from './default.js';
import type { ChatInputCommandInteraction, User } from 'discord.js';
import { MessageFlags } from 'discord.js';
import {
  mockSetDefaultConfigResponse,
  mockListWalletKeysResponse,
  mockListLlmConfigsResponse,
} from '@tzurot/common-types';

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
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock command helpers
vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: vi.fn().mockResolvedValue(undefined),
  handleCommandError: vi.fn().mockResolvedValue(undefined),
}));

import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';

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

  // Helper to mock all API calls for a non-guest user with free config
  function mockNonGuestUserApis(configId: string, configName: string) {
    vi.mocked(callGatewayApi).mockImplementation((path: string) => {
      if (path === '/wallet/list') {
        return Promise.resolve({
          ok: true,
          data: mockListWalletKeysResponse([{ isActive: true }]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true,
          data: mockListLlmConfigsResponse([
            { id: configId, name: configName, model: 'openai/gpt-4o-mini' },
          ]),
        });
      }
      if (path === '/user/model-override/default') {
        return Promise.resolve({
          ok: true,
          data: mockSetDefaultConfigResponse({
            default: { configId, configName },
          }),
        });
      }
      return Promise.resolve({ ok: false, error: 'Unknown path' });
    });
  }

  it('should call API with correct parameters', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-456');
    mockNonGuestUserApis('config-456', 'Test Config');

    await handleSetDefault(mockInteraction);

    expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'PUT',
      userId: 'user-123',
      body: { configId: 'config-456' },
    });
  });

  it('should display success embed on successful update', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-123');
    mockNonGuestUserApis('config-123', 'My Default Config');

    await handleSetDefault(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Default Preset Set'),
          }),
        }),
      ],
    });
  });

  it('should show error when API returns error', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-123');
    vi.mocked(callGatewayApi).mockImplementation((path: string) => {
      if (path === '/wallet/list') {
        return Promise.resolve({
          ok: true,
          data: mockListWalletKeysResponse([{ isActive: true }]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true,
          data: mockListLlmConfigsResponse([
            { id: 'config-123', name: 'Test', model: 'openai/gpt-4o-mini' },
          ]),
        });
      }
      if (path === '/user/model-override/default') {
        return Promise.resolve({
          ok: false,
          error: 'Config not found',
          status: 404,
        });
      }
      return Promise.resolve({ ok: false, error: 'Unknown path' });
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
      command: 'Preset Default',
    });
  });

  it('should show error when guest user tries to set premium model as default', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('premium-config');
    vi.mocked(callGatewayApi).mockImplementation((path: string) => {
      if (path === '/wallet/list') {
        // No active wallet keys = guest mode
        return Promise.resolve({
          ok: true,
          data: mockListWalletKeysResponse([]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true,
          data: mockListLlmConfigsResponse([
            { id: 'premium-config', name: 'Premium Config', model: 'openai/gpt-4o' },
          ]),
        });
      }
      return Promise.resolve({ ok: false, error: 'Should not be called' });
    });

    await handleSetDefault(mockInteraction);

    // Should NOT call the set-default API
    expect(callGatewayApi).not.toHaveBeenCalledWith(
      '/user/model-override/default',
      expect.anything()
    );

    // Should show error embed
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '❌ Premium Model Not Available',
          }),
        }),
      ],
    });
  });

  it('should allow guest user to set free model as default', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('free-config');
    vi.mocked(callGatewayApi).mockImplementation((path: string) => {
      if (path === '/wallet/list') {
        // No active wallet keys = guest mode
        return Promise.resolve({
          ok: true,
          data: mockListWalletKeysResponse([]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true,
          data: mockListLlmConfigsResponse([
            {
              id: 'free-config',
              name: 'Free Config',
              model: 'meta-llama/llama-3.3-70b-instruct:free',
            },
          ]),
        });
      }
      if (path === '/user/model-override/default') {
        return Promise.resolve({
          ok: true,
          data: mockSetDefaultConfigResponse({
            default: { configId: 'free-config', configName: 'Free Config' },
          }),
        });
      }
      return Promise.resolve({ ok: false, error: 'Unknown path' });
    });

    await handleSetDefault(mockInteraction);

    // Should call the set-default API
    expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'PUT',
      userId: 'user-123',
      body: { configId: 'free-config' },
    });

    // Should show success embed
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Default Preset Set'),
          }),
        }),
      ],
    });
  });
});
