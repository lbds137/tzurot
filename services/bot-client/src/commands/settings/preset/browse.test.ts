/**
 * Tests for the settings preset browse wrapper.
 *
 * The interaction logic lives in `utils/overrideBrowse.ts` (tested there);
 * this verifies the preset config is wired to the right client calls and
 * customId prefix — including the kind-aware two-call fetch + kind-carrying
 * clear (a character can have both a text and a vision override).
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

// Silence the real pino logger that browse.ts initializes at module load.
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

type OverrideRow = { personalityId: string; personalityName: string; configName: string | null };

/**
 * The preset config issues one `listModelOverrides` call per kind; mock by the
 * `?kind=` arg so text and vision return distinct rows (order-independent).
 */
function mockOverridesByKind(text: OverrideRow[], vision: OverrideRow[] = []): void {
  stub.listModelOverrides.mockImplementation((opts?: { kind?: string }) =>
    Promise.resolve(makeOk(mockListModelOverridesResponse(opts?.kind === 'vision' ? vision : text)))
  );
}

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
  it('lists overrides of both kinds and renders them (vision badged)', async () => {
    mockOverridesByKind(
      [{ personalityId: 'p1', personalityName: 'Lilith', configName: 'Fast' }],
      [{ personalityId: 'p2', personalityName: 'Aria', configName: 'GPT-4o' }]
    );
    const editReply = vi.fn();
    const context = {
      user: { id: 'u1' },
      interaction: {} as never,
      editReply,
    } as unknown as Parameters<typeof handlePresetBrowse>[0];

    await handlePresetBrowse(context);

    // Both kinds fetched (one call each).
    expect(stub.listModelOverrides).toHaveBeenCalledWith({ kind: 'text' });
    expect(stub.listModelOverrides).toHaveBeenCalledWith({ kind: 'vision' });
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const description = arg.embeds[0].toJSON().description ?? '';
    expect(description).toContain('Lilith');
    expect(description).toContain('Aria');
    expect(description).toContain('👁️'); // the vision override is badged
  });
});

describe('handlePresetBrowseSelect', () => {
  it('routes a kind-encoded selection to the shared select handler (shows confirm)', async () => {
    mockOverridesByKind([{ personalityId: 'p1', personalityName: 'Lilith', configName: 'Fast' }]);
    const editReply = vi.fn();
    const interaction = {
      values: ['p1::text'],
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
  it('clears the model override of the carried kind on confirm', async () => {
    stub.deleteModelOverride.mockResolvedValue(makeOk({ deleted: true }));
    mockOverridesByKind([]);
    const interaction = {
      customId: 'settings-preset-override::clear::p1::vision',
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as Parameters<typeof handlePresetBrowseButton>[0];

    await handlePresetBrowseButton(interaction);

    expect(stub.deleteModelOverride).toHaveBeenCalledWith('p1', { kind: 'vision' });
  });
});
