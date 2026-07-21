/**
 * Tests for Preset Set-Default Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetDefault } from './set-default.js';
import {
  mockSetDefaultConfigResponse,
  mockListWalletKeysResponse,
  mockListLlmConfigsResponse,
} from '@tzurot/test-factories';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

// Mock logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const stub = {
  listWalletKeys: vi.fn(),
  listUserLlmConfigs: vi.fn(),
  setDefaultModelConfig: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

describe('handleSetDefault', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.listWalletKeys.mockReset();
    stub.listUserLlmConfigs.mockReset();
    stub.setDefaultModelConfig.mockReset();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext(configId: string, slot?: string) {
    return {
      user: { id: 'user-123', username: 'testuser' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'preset') return configId;
            if (name === 'slot') return slot ?? null;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSetDefault>[0];
  }

  // Helper to mock all stubs for a non-guest user with free config
  function mockNonGuestUserApis(configId: string, configName: string) {
    stub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([{ isActive: true }])));
    stub.listUserLlmConfigs.mockResolvedValue(
      makeOk(
        mockListLlmConfigsResponse([
          { id: configId, name: configName, model: 'openai/gpt-4o-mini' },
        ])
      )
    );
    stub.setDefaultModelConfig.mockResolvedValue(
      makeOk(mockSetDefaultConfigResponse({ default: { configId, configName } }))
    );
  }

  it('should call setDefaultModelConfig with correct parameters', async () => {
    mockNonGuestUserApis('00000000-0000-4000-8000-000000000456', 'Test Config');

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-000000000456'));

    // No slot option → defaults to the text (chat) default.
    expect(stub.setDefaultModelConfig).toHaveBeenCalledWith(
      { configId: '00000000-0000-4000-8000-000000000456' },
      { slot: 'text' }
    );
  });

  it('sends the vision slot when slot:vision is chosen (the vision-default fix)', async () => {
    mockNonGuestUserApis('00000000-0000-4000-8000-0000000000a1', 'Gemini Vision');

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-0000000000a1', 'vision'));

    // The slot must reach the gateway — without it, a vision default silently
    // lands in the text slot (the bug this fix closes).
    expect(stub.setDefaultModelConfig).toHaveBeenCalledWith(
      { configId: '00000000-0000-4000-8000-0000000000a1' },
      { slot: 'vision' }
    );
    // The confirmation names the vision slot.
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('Your default vision (image) preset is now'),
          }),
        }),
      ],
    });
  });

  it('should display success embed on successful update', async () => {
    mockNonGuestUserApis('00000000-0000-4000-8000-000000000123', 'My Default Config');

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-000000000123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Default Preset Set'),
            // Default (text) slot is named in the confirmation.
            description: expect.stringContaining('Your default chat preset is now'),
          }),
        }),
      ],
    });
  });

  it('should show error when API returns error', async () => {
    stub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([{ isActive: true }])));
    stub.listUserLlmConfigs.mockResolvedValue(
      makeOk(
        mockListLlmConfigsResponse([
          {
            id: '00000000-0000-4000-8000-000000000123',
            name: 'Test',
            model: 'openai/gpt-4o-mini',
            provider: 'openrouter',
          },
        ])
      )
    );
    stub.setDefaultModelConfig.mockResolvedValue(makeErr(404, 'Config not found'));

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-000000000123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Config not found',
    });
  });

  it('should handle network errors', async () => {
    stub.listWalletKeys.mockRejectedValue(new Error('Network error'));

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-000000000123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to set the default. Please try again.',
    });
  });

  it('should show error when guest user tries to set premium model as default', async () => {
    stub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([])));
    stub.listUserLlmConfigs.mockResolvedValue(
      makeOk(
        mockListLlmConfigsResponse([
          {
            id: '00000000-0000-4000-8000-000000000100',
            name: 'Premium Config',
            model: 'openai/gpt-4o',
            provider: 'openrouter',
          },
        ])
      )
    );

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-000000000100'));

    expect(stub.setDefaultModelConfig).not.toHaveBeenCalled();
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
    stub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([])));
    stub.listUserLlmConfigs.mockResolvedValue(
      makeOk(
        mockListLlmConfigsResponse([
          {
            id: '00000000-0000-4000-8000-000000000f00',
            name: 'Free Config',
            model: 'meta-llama/llama-3.3-70b-instruct:free',
            provider: 'openrouter',
          },
        ])
      )
    );
    stub.setDefaultModelConfig.mockResolvedValue(
      makeOk(
        mockSetDefaultConfigResponse({
          default: { configId: '00000000-0000-4000-8000-000000000f00', configName: 'Free Config' },
        })
      )
    );

    await handleSetDefault(createMockContext('00000000-0000-4000-8000-000000000f00'));

    expect(stub.setDefaultModelConfig).toHaveBeenCalledWith(
      { configId: '00000000-0000-4000-8000-000000000f00' },
      { slot: 'text' }
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Default Preset Set'),
            // Default (text) slot is named in the confirmation.
            description: expect.stringContaining('Your default chat preset is now'),
          }),
        }),
      ],
    });
  });
});
