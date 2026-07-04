/**
 * Tests for /voice tts autocomplete handler.
 * Locks the dual personality+tts dispatch + provider-badge formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const { mockHandlePersonalityAutocomplete } = vi.hoisted(() => ({
  mockHandlePersonalityAutocomplete: vi.fn(),
}));

const stub = {
  listUserTtsConfigs: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('../../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: mockHandlePersonalityAutocomplete,
}));

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

const { handleAutocomplete } = await import('./autocomplete.js');

function makeInteraction(focusedName: string, focusedValue: string) {
  return {
    user: { id: 'discord-user-1' },
    guildId: 'guild-1',
    commandName: 'settings',
    options: {
      getFocused: () => ({ name: focusedName, value: focusedValue }),
      getSubcommand: () => 'set',
    },
    respond: vi.fn(),
  };
}

describe('handleAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.listUserTtsConfigs.mockReset();
  });

  it('routes character option to handlePersonalityAutocomplete', async () => {
    const interaction = makeInteraction('character', 'Al');

    await handleAutocomplete(interaction as never);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ optionName: 'character' })
    );
  });

  it('queries listUserTtsConfigs for tts option and formats with provider badge', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [
          {
            id: 'c1',
            name: 'kyutai-self-hosted',
            provider: 'self-hosted',
            modelId: null,
            isGlobal: true,
            isDefault: false,
            isFreeDefault: true,
            isOwned: false,
            permissions: { canEdit: false, canDelete: false },
          },
        ],
      })
    );
    const interaction = makeInteraction('tts', 'kyutai');

    await handleAutocomplete(interaction as never);

    expect(stub.listUserTtsConfigs).toHaveBeenCalled();
    expect(interaction.respond).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ value: 'c1' })])
    );
  });

  it('responds empty list on gateway failure', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const interaction = makeInteraction('tts', '');

    await handleAutocomplete(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('responds empty list for unknown option name', async () => {
    const interaction = makeInteraction('unknown', '');

    await handleAutocomplete(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('filters tts configs by query against name + provider + modelId', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [
          {
            id: 'c1',
            name: 'kyutai-self-hosted',
            provider: 'self-hosted',
            modelId: null,
            isGlobal: true,
            isDefault: false,
            isFreeDefault: true,
            isOwned: false,
            permissions: { canEdit: false, canDelete: false },
          },
          {
            id: 'c2',
            name: 'mistral-voxtral-mini',
            provider: 'mistral',
            modelId: 'voxtral-mini-tts-2603',
            isGlobal: true,
            isDefault: false,
            isFreeDefault: false,
            isOwned: false,
            permissions: { canEdit: false, canDelete: false },
          },
        ],
      })
    );
    const interaction = makeInteraction('tts', 'mistral');

    await handleAutocomplete(interaction as never);

    const responded = vi.mocked(interaction.respond).mock.calls[0][0] as Array<{ value: string }>;
    expect(responded.find(c => c.value === 'c2')).toBeDefined();
    expect(responded.find(c => c.value === 'c1')).toBeUndefined();
  });
});
