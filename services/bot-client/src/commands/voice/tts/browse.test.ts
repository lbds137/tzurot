/**
 * Tests for the voice TTS browse wrapper.
 *
 * The interaction logic lives in `utils/overrideBrowse.ts` (tested there);
 * this verifies the TTS config is wired to the right client calls and
 * customId prefix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type EmbedBuilder } from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import { makeOk } from '../../../test/gatewayClientStubs.js';
import {
  handleTtsBrowse,
  handleTtsBrowseSelect,
  handleTtsBrowseButton,
  isTtsOverrideInteraction,
} from './browse.js';

const stub = {
  listTtsOverrides: vi.fn(),
  deleteTtsOverride: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  stub.listTtsOverrides.mockReset();
  stub.deleteTtsOverride.mockReset();
});

describe('isTtsOverrideInteraction', () => {
  it('matches the tts-override prefix only', () => {
    expect(isTtsOverrideInteraction('voice-tts-override::select')).toBe(true);
    expect(isTtsOverrideInteraction('settings-preset-override::select')).toBe(false);
    expect(isTtsOverrideInteraction('voice-voices::x')).toBe(false);
  });
});

describe('handleTtsBrowse', () => {
  it('lists tts overrides and renders them', async () => {
    stub.listTtsOverrides.mockResolvedValue(
      makeOk({ overrides: [{ personalityId: 'p1', personalityName: 'Bob', configName: 'Aria' }] })
    );
    const editReply = vi.fn();
    const context = {
      user: { id: 'u1' },
      interaction: {} as never,
      editReply,
    } as unknown as Parameters<typeof handleTtsBrowse>[0];

    await handleTtsBrowse(context);

    expect(stub.listTtsOverrides).toHaveBeenCalled();
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().description).toContain('Bob');
  });
});

describe('handleTtsBrowseSelect', () => {
  it('routes the selection to the shared select handler (shows confirm)', async () => {
    stub.listTtsOverrides.mockResolvedValue(
      makeOk({ overrides: [{ personalityId: 'p1', personalityName: 'Bob', configName: 'Aria' }] })
    );
    const editReply = vi.fn();
    const interaction = {
      values: ['p1'],
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply,
    } as unknown as Parameters<typeof handleTtsBrowseSelect>[0];

    await handleTtsBrowseSelect(interaction);

    expect(stub.listTtsOverrides).toHaveBeenCalled();
    const arg = editReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(arg.embeds[0].toJSON().title).toContain('Clear TTS override?');
  });
});

describe('handleTtsBrowseButton', () => {
  it('clears the tts override on confirm', async () => {
    stub.deleteTtsOverride.mockResolvedValue(makeOk({ deleted: true }));
    stub.listTtsOverrides.mockResolvedValue(makeOk({ overrides: [] }));
    const interaction = {
      customId: 'voice-tts-override::clear::p1',
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as Parameters<typeof handleTtsBrowseButton>[0];

    await handleTtsBrowseButton(interaction);

    expect(stub.deleteTtsOverride).toHaveBeenCalledWith('p1');
  });
});

describe('voice TTS override batch clear ("Select several" — C2 & C5)', () => {
  it('renders the Select several toggle row when overrides exist and omits it when empty', async () => {
    stub.listTtsOverrides.mockResolvedValue(
      makeOk({ overrides: [{ personalityId: 'p1', personalityName: 'Bob', configName: 'Aria' }] })
    );
    const editReply = vi.fn();
    const context = {
      user: { id: 'u1' },
      interaction: {} as never,
      editReply,
    } as unknown as Parameters<typeof handleTtsBrowse>[0];

    await handleTtsBrowse(context);

    const rendered = editReply.mock.calls[0][0] as {
      components: { toJSON: () => { components: { custom_id: string; label?: string }[] } }[];
    };
    expect(rendered.components).toHaveLength(2);
    expect(rendered.components[1].toJSON().components[0]).toMatchObject({
      custom_id: 'voice-tts-override::batch-select',
      label: 'Select several',
    });

    editReply.mockClear();
    stub.listTtsOverrides.mockResolvedValue(makeOk({ overrides: [] }));
    await handleTtsBrowse(context);
    const emptyRendered = editReply.mock.calls[0][0] as { components: unknown[] };
    expect(emptyRendered.components).toHaveLength(0);
  });

  it('routes single select to single-confirm and batch-select to batch-confirm, then clears bare personalityIds on batch-confirm (C2, C5)', async () => {
    stub.listTtsOverrides.mockResolvedValue(
      makeOk({
        overrides: [
          { personalityId: 'p1', personalityName: 'Bob', configName: 'Aria' },
          { personalityId: 'p2', personalityName: 'Lilith', configName: 'Siren' },
        ],
      })
    );
    stub.deleteTtsOverride.mockResolvedValue(makeOk({ deleted: true }));

    // C2: single-pick select routes to single-confirm.
    const singleEditReply = vi.fn();
    await handleTtsBrowseSelect({
      customId: 'voice-tts-override::select',
      values: ['p1'],
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: singleEditReply,
    } as unknown as Parameters<typeof handleTtsBrowseSelect>[0]);
    const singleArg = singleEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    expect(singleArg.embeds[0].toJSON().title).toBe('Clear TTS override?');

    // Batch entry swap -> multi-select
    const entryEditReply = vi.fn();
    await handleTtsBrowseButton({
      customId: 'voice-tts-override::batch-select',
      user: { id: 'u1' },
      deferUpdate: vi.fn(),
      editReply: entryEditReply,
    } as unknown as Parameters<typeof handleTtsBrowseButton>[0]);
    const entryComponents = (entryEditReply.mock.calls[0][0] as { components: unknown[] })
      .components;

    // Batch pick -> batch confirm
    const pickEditReply = vi.fn();
    await handleTtsBrowseSelect({
      customId: 'voice-tts-override::batch-select',
      values: ['p1', 'p2'],
      user: { id: 'u1' },
      message: { components: entryComponents },
      deferUpdate: vi.fn(),
      editReply: pickEditReply,
    } as unknown as Parameters<typeof handleTtsBrowseSelect>[0]);
    const confirmEmbed = (
      pickEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] }
    ).embeds[0].toJSON();
    expect(confirmEmbed.title).toBe('🎤 Clear TTS Overrides?');
    expect(confirmEmbed.footer?.text).toBe('p1\np2');

    // C5: batch confirm clears bare personalityIds with no slot argument.
    const confirmEditReply = vi.fn().mockResolvedValue(undefined);
    await handleTtsBrowseButton({
      customId: 'voice-tts-override::batch-confirm',
      user: { id: 'u1' },
      deferred: false,
      replied: false,
      message: { embeds: [confirmEmbed], components: [] },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: confirmEditReply,
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleTtsBrowseButton>[0]);

    expect(stub.deleteTtsOverride).toHaveBeenCalledTimes(2);
    expect(stub.deleteTtsOverride).toHaveBeenNthCalledWith(1, 'p1');
    expect(stub.deleteTtsOverride).toHaveBeenNthCalledWith(2, 'p2');
  });
});
