/**
 * Tests for the preset override browse wrapper.
 *
 * The interaction logic lives in `utils/overrideBrowse.ts` (tested there);
 * this verifies the preset config is wired to the right client calls and
 * customId prefix — including the single all-slots fetch + slot-carrying clear
 * (a character can have both a text and a vision override).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type EmbedBuilder } from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import { mockListModelOverridesResponse } from '@tzurot/test-factories';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
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
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

type OverrideRow = {
  personalityId: string;
  personalityName: string;
  configName: string | null;
  slot?: 'text' | 'vision';
  supportsVision?: boolean;
};

/**
 * The preset config issues ONE all-slots `listModelOverrides` call; the gateway
 * emits a row per non-null FK, each tagged with its `slot`. The mock returns the
 * given rows (each carrying its own slot) regardless of the call args.
 */
function mockAllOverrides(rows: OverrideRow[]): void {
  stub.listModelOverrides.mockResolvedValue(makeOk(mockListModelOverridesResponse(rows)));
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
  it('lists overrides of both slots and renders them (vision badged)', async () => {
    mockAllOverrides([
      { personalityId: 'p1', personalityName: 'Lilith', configName: 'Fast', slot: 'text' },
      {
        personalityId: 'p2',
        personalityName: 'Aria',
        configName: 'GPT-4o',
        slot: 'vision',
        supportsVision: true,
      },
    ]);
    const editReply = vi.fn();
    const context = {
      user: { id: 'u1' },
      interaction: {} as never,
      editReply,
    } as unknown as Parameters<typeof handlePresetBrowse>[0];

    await handlePresetBrowse(context);

    // Both slots come back from ONE all-slots call.
    expect(stub.listModelOverrides).toHaveBeenCalledTimes(1);
    expect(stub.listModelOverrides).toHaveBeenCalledWith({ slot: 'all' });
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const description = arg.embeds[0].toJSON().description ?? '';
    expect(description).toContain('Lilith');
    expect(description).toContain('Aria');
    expect(description).toContain('👁️'); // the vision override is badged
  });

  it('renders the load-failure message when the all-slots list call fails', async () => {
    // The list closure returns null on a failed gateway call → the shared
    // browser surfaces the load-failure notice (covers the closure error path).
    stub.listModelOverrides.mockResolvedValue(makeErr(500, 'Server error'));
    const editReply = vi.fn();
    const context = {
      user: { id: 'u1' },
      interaction: {} as never,
      editReply,
    } as unknown as Parameters<typeof handlePresetBrowse>[0];

    await handlePresetBrowse(context);

    expect(stub.listModelOverrides).toHaveBeenCalledWith({ slot: 'all' });
    const arg = editReply.mock.calls[0][0] as { content?: string };
    expect(arg.content).toContain('Failed to load overrides');
  });
});

describe('handlePresetBrowseSelect', () => {
  it('routes a slot-encoded selection to the shared select handler (shows confirm)', async () => {
    mockAllOverrides([
      { personalityId: 'p1', personalityName: 'Lilith', configName: 'Fast', slot: 'text' },
    ]);
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
  it('clears the model override of the carried slot on confirm', async () => {
    stub.deleteModelOverride.mockResolvedValue(makeOk({ deleted: true }));
    mockAllOverrides([]);
    const interaction = {
      customId: 'settings-preset-override::clear::p1::vision',
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as Parameters<typeof handlePresetBrowseButton>[0];

    await handlePresetBrowseButton(interaction);

    expect(stub.deleteModelOverride).toHaveBeenCalledWith('p1', { slot: 'vision' });
  });
});
