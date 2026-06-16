/**
 * Tests for the settings preset browse wrapper.
 *
 * The interaction logic lives in `utils/overrideBrowse.ts` (tested there);
 * this verifies the preset config is wired to the right client calls and
 * customId prefix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import { mockListModelOverridesResponse } from '@tzurot/test-factories';
import { makeOk } from '../../../test/gatewayClientStubs.js';
import {
  handlePresetBrowse,
  handlePresetBrowseSelect,
  handlePresetBrowseButton,
  isPresetOverrideInteraction,
} from './browse.js';

const stub = {
  listModelOverrides: vi.fn(),
  deleteModelOverride: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  stub.listModelOverrides.mockReset();
  stub.deleteModelOverride.mockReset();
});

describe('isPresetOverrideInteraction', () => {
  it('matches the preset-override prefix only', () => {
    expect(isPresetOverrideInteraction('settings-preset-override::select')).toBe(true);
    expect(isPresetOverrideInteraction('voice-tts-override::select')).toBe(false);
    expect(isPresetOverrideInteraction('user-defaults-settings::x')).toBe(false);
  });
});

describe('handlePresetBrowse', () => {
  it('lists model overrides and renders them', async () => {
    stub.listModelOverrides.mockResolvedValue(
      makeOk(
        mockListModelOverridesResponse([
          { personalityId: 'p1', personalityName: 'Lilith', configName: 'Fast' },
        ])
      )
    );
    const editReply = vi.fn();
    const context = {
      user: { id: 'u1' },
      interaction: {} as never,
      editReply,
    } as unknown as Parameters<typeof handlePresetBrowse>[0];

    await handlePresetBrowse(context);

    expect(stub.listModelOverrides).toHaveBeenCalled();
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().description).toContain('Lilith');
  });
});

describe('handlePresetBrowseSelect', () => {
  it('routes the selection to the shared select handler (shows confirm)', async () => {
    stub.listModelOverrides.mockResolvedValue(
      makeOk(
        mockListModelOverridesResponse([
          { personalityId: 'p1', personalityName: 'Lilith', configName: 'Fast' },
        ])
      )
    );
    const editReply = vi.fn();
    const interaction = {
      values: ['p1'],
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply,
    } as unknown as Parameters<typeof handlePresetBrowseSelect>[0];

    await handlePresetBrowseSelect(interaction);

    expect(stub.listModelOverrides).toHaveBeenCalled();
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().title).toContain('Clear preset override?');
  });
});

describe('handlePresetBrowseButton', () => {
  it('clears the model override on confirm', async () => {
    stub.deleteModelOverride.mockResolvedValue(makeOk({ deleted: true }));
    stub.listModelOverrides.mockResolvedValue(makeOk({ overrides: [] }));
    const interaction = {
      customId: 'settings-preset-override::clear::p1',
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as Parameters<typeof handlePresetBrowseButton>[0];

    await handlePresetBrowseButton(interaction);

    expect(stub.deleteModelOverride).toHaveBeenCalledWith('p1');
  });
});
