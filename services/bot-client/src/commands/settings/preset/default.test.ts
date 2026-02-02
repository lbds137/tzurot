/**
 * Tests for Preset Default Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDefault } from './default.js';
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
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
}));

import { callGatewayApi } from '../../../utils/userGatewayClient.js';

describe('handleDefault', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext(configId: string) {
    return {
      user: { id: 'user-123' },
      interaction: {
        options: {
          getString: (_name: string, _required?: boolean) => configId,
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleDefault>[0];
  }

  // Helper to mock all API calls for a non-guest user with free config
  function mockNonGuestUserApis(configId: string, configName: string) {
    vi.mocked(callGatewayApi).mockImplementation(((path: string) => {
      if (path === '/wallet/list') {
        return Promise.resolve({
          ok: true as const,
          data: mockListWalletKeysResponse([{ isActive: true }]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true as const,
          data: mockListLlmConfigsResponse([
            { id: configId, name: configName, model: 'openai/gpt-4o-mini' },
          ]),
        });
      }
      if (path === '/user/model-override/default') {
        return Promise.resolve({
          ok: true as const,
          data: mockSetDefaultConfigResponse({
            default: { configId, configName },
          }),
        });
      }
      return Promise.resolve({ ok: false as const, error: 'Unknown path' });
    }) as never);
  }

  it('should call API with correct parameters', async () => {
    mockNonGuestUserApis('config-456', 'Test Config');

    await handleDefault(createMockContext('config-456'));

    expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'PUT',
      userId: 'user-123',
      body: { configId: 'config-456' },
    });
  });

  it('should display success embed on successful update', async () => {
    mockNonGuestUserApis('config-123', 'My Default Config');

    await handleDefault(createMockContext('config-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
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
    vi.mocked(callGatewayApi).mockImplementation(((path: string) => {
      if (path === '/wallet/list') {
        return Promise.resolve({
          ok: true as const,
          data: mockListWalletKeysResponse([{ isActive: true }]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true as const,
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
      return Promise.resolve({ ok: false as const, error: 'Unknown path' });
    }) as never);

    await handleDefault(createMockContext('config-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to set default: Config not found',
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

    await handleDefault(createMockContext('config-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });

  it('should show error when guest user tries to set premium model as default', async () => {
    vi.mocked(callGatewayApi).mockImplementation(((path: string) => {
      if (path === '/wallet/list') {
        // No active wallet keys = guest mode
        return Promise.resolve({
          ok: true as const,
          data: mockListWalletKeysResponse([]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true as const,
          data: mockListLlmConfigsResponse([
            { id: 'premium-config', name: 'Premium Config', model: 'openai/gpt-4o' },
          ]),
        });
      }
      return Promise.resolve({ ok: false as const, error: 'Should not be called' });
    }) as never);

    await handleDefault(createMockContext('premium-config'));

    // Should NOT call the set-default API
    expect(callGatewayApi).not.toHaveBeenCalledWith(
      '/user/model-override/default',
      expect.anything()
    );

    // Should show error embed
    expect(mockEditReply).toHaveBeenCalledWith({
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
    vi.mocked(callGatewayApi).mockImplementation(((path: string) => {
      if (path === '/wallet/list') {
        // No active wallet keys = guest mode
        return Promise.resolve({
          ok: true as const,
          data: mockListWalletKeysResponse([]),
        });
      }
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true as const,
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
          ok: true as const,
          data: mockSetDefaultConfigResponse({
            default: { configId: 'free-config', configName: 'Free Config' },
          }),
        });
      }
      return Promise.resolve({ ok: false as const, error: 'Unknown path' });
    }) as never);

    await handleDefault(createMockContext('free-config'));

    // Should call the set-default API
    expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'PUT',
      userId: 'user-123',
      body: { configId: 'free-config' },
    });

    // Should show success embed
    expect(mockEditReply).toHaveBeenCalledWith({
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
