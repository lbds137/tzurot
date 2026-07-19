/**
 * Tests for /voice view handler.
 * Locks the single-round-trip resolution endpoint shape, the title
 * including the character name, and the embed structure (TTS + STT
 * fields, no Cloned Voices section, no footer).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  getVoiceResolution: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    voiceViewOptions: vi.fn(() => ({
      character: () => 'personality-uuid-1',
    })),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/apiCheck.js', () => ({
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE: '⚠️ Autocomplete unavailable',
  isAutocompleteErrorSentinel: vi.fn(() => false),
}));

const { handleVoiceView } = await import('./view.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleVoiceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.getVoiceResolution.mockReset();
  });

  it('calls userClient.getVoiceResolution with the picked personalityId', async () => {
    stub.getVoiceResolution.mockResolvedValue(
      makeOk({
        personalityName: 'Test Character',
        tts: {
          configId: 'cfg-1',
          configName: 'kyutai',
          provider: 'self-hosted',
          source: 'free-default',
        },
        stt: { provider: 'voice-engine', source: 'hardcoded' },
        voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
      })
    );

    await handleVoiceView(makeContext() as never);

    expect(stub.getVoiceResolution).toHaveBeenCalledWith({ personalityId: 'personality-uuid-1' });
  });

  it('renders an embed scoped to the resolved character (title + TTS + STT)', async () => {
    // Pin the character-scoping signal that was missing before the overhaul:
    // the embed title MUST name the character so the view doesn't read like
    // global state. Cloned-voice library is intentionally NOT shown — that's
    // user-scoped and lives in /voice voices browse.
    stub.getVoiceResolution.mockResolvedValue(
      makeOk({
        personalityName: 'Lila',
        tts: {
          configId: 'cfg-1',
          configName: 'mistral-config',
          provider: 'mistral',
          source: 'user-default',
        },
        stt: { provider: 'mistral', source: 'tts-derived' },
        voices: {
          tzurotCount: 3,
          totalVoices: 3,
          previewSlugs: ['alice', 'bob', 'carol'],
        },
      })
    );
    const context = makeContext();

    await handleVoiceView(context as never);

    const reply = context.editReply.mock.calls[0]?.[0];
    expect(reply).toEqual(expect.objectContaining({ embeds: expect.any(Array) }));

    const embed = reply.embeds[0];
    const json = embed.toJSON ? embed.toJSON() : embed.data;
    expect(json.title).toContain('Lila');
    const fieldNames = (json.fields ?? []).map((f: { name: string }) => f.name);
    expect(fieldNames.some((n: string) => n.includes('TTS'))).toBe(true);
    expect(fieldNames.some((n: string) => n.includes('STT'))).toBe(true);
    // Cloned Voices field intentionally absent (user-scoped data, not character-scoped)
    expect(fieldNames.some((n: string) => n.includes('Cloned Voices'))).toBe(false);
    // Footer dropped — title now carries the character-scoping signal
    expect(json.footer).toBeUndefined();
  });

  it.each([
    { ttsSource: 'user-personality', sttSource: 'user-default' },
    { ttsSource: 'user-default', sttSource: 'user-default' },
    { ttsSource: 'personality', sttSource: 'tts-derived' },
    { ttsSource: 'free-default', sttSource: 'tts-derived' },
    { ttsSource: 'hardcoded', sttSource: 'hardcoded' },
  ] as const)(
    'renders cascade labels for tts.source=$ttsSource + stt.source=$sttSource',
    async ({ ttsSource, sttSource }) => {
      // Pins each cascade-source branch in the label switch — without this,
      // a future cascade-source addition that forgets a `case` arm would
      // silently produce `undefined` in the embed body.
      stub.getVoiceResolution.mockResolvedValue(
        makeOk({
          personalityName: 'Char',
          tts: {
            configId: null,
            configName: null,
            provider: 'self-hosted',
            source: ttsSource,
          },
          stt: { provider: 'voice-engine', source: sttSource },
          voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
        })
      );
      const context = makeContext();
      await handleVoiceView(context as never);

      const reply = context.editReply.mock.calls[0]?.[0];
      const embed = reply.embeds[0];
      const json = embed.toJSON ? embed.toJSON() : embed.data;
      const ttsField = (json.fields ?? []).find((f: { name: string }) => f.name.includes('TTS'));
      const sttField = (json.fields ?? []).find((f: { name: string }) => f.name.includes('STT'));
      expect(ttsField?.value).not.toContain('undefined');
      expect(sttField?.value).not.toContain('undefined');
    }
  );

  it('reports gateway error', async () => {
    stub.getVoiceResolution.mockResolvedValue(makeErr(500, 'oops'));
    const context = makeContext();

    await handleVoiceView(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('oops'),
    });
  });

  it('reports an unexpected exception through the classifier', async () => {
    stub.getVoiceResolution.mockRejectedValue(new Error('boom'));
    const context = makeContext();

    await handleVoiceView(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('voice settings'),
    });
  });

  it('renders read-transient copy, never write-uncertainty, on a network-kind failure', async () => {
    // This handler only READS — omitting operation:'read' would make a
    // network failure claim "your change may still be applying" for a
    // change that was never submitted.
    stub.getVoiceResolution.mockResolvedValue(makeErr(0, 'connection lost'));
    const context = makeContext();

    await handleVoiceView(context as never);

    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    expect(content).toContain("Couldn't load the voice settings");
    expect(content).not.toContain('may still');
  });

  it('refuses the autocomplete error sentinel without calling the gateway', async () => {
    const apiCheck = await import('../../utils/apiCheck.js');
    vi.mocked(apiCheck.isAutocompleteErrorSentinel).mockReturnValueOnce(true);

    await handleVoiceView(makeContext() as never);

    expect(stub.getVoiceResolution).not.toHaveBeenCalled();
  });
});
