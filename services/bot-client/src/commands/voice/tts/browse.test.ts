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
