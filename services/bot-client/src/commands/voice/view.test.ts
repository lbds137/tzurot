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

  it('calls userClient.getVoiceResolution with the picked personalityId and the invoking channel', async () => {
    stub.getVoiceResolution.mockResolvedValue(
      makeOk({
        personalityName: 'Test Character',
        voiceEnabled: true,
        voiceResponseMode: { value: 'always', source: 'hardcoded' },
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

    expect(stub.getVoiceResolution).toHaveBeenCalledWith({
      personalityId: 'personality-uuid-1',
      channelId: undefined,
    });
  });

  it('renders an embed scoped to the resolved character (title + TTS + STT)', async () => {
    // Pin the character-scoping signal that was missing before the overhaul:
    // the embed title MUST name the character so the view doesn't read like
    // global state. Cloned-voice library is intentionally NOT shown — that's
    // user-scoped and lives in /voice voices browse.
    stub.getVoiceResolution.mockResolvedValue(
      makeOk({
        personalityName: 'Lila',
        voiceEnabled: true,
        voiceResponseMode: { value: 'always', source: 'hardcoded' },
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
          voiceEnabled: false,
          voiceResponseMode: { value: 'never', source: 'user-personality' },
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

  describe('Voice replies + voice-enabled fields', () => {
    const makePayload = (
      voiceResponseMode: { value: string; source: string },
      voiceEnabled: boolean
    ) =>
      makeOk({
        personalityName: 'Char',
        voiceEnabled,
        voiceResponseMode,
        tts: {
          configId: null,
          configName: null,
          provider: 'self-hosted',
          source: 'hardcoded' as const,
        },
        stt: { provider: 'voice-engine', source: 'hardcoded' as const },
        voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
      });

    const renderFields = async (payload: ReturnType<typeof makeOk>) => {
      stub.getVoiceResolution.mockResolvedValue(payload);
      const context = makeContext();
      await handleVoiceView(context as never);
      const reply = context.editReply.mock.calls[0]?.[0];
      return (reply.embeds[0].toJSON().fields ?? []) as { name: string; value: string }[];
    };

    it('renders a Voice replies field with the resolved mode + source + the command that changes it', async () => {
      const fields = await renderFields(
        makePayload({ value: 'always', source: 'hardcoded' }, true)
      );

      const field = fields.find(f => f.name.includes('Voice replies'));
      expect(field).toBeDefined();
      expect(field?.value).toContain('Always');
      expect(field?.value).toContain('built-in default');
      expect(field?.value).toContain('/voice replies');
    });

    it('renders a voice-enabled field, ✅ or ❌, naming the creator as the setter', async () => {
      const enabled = await renderFields(
        makePayload({ value: 'always', source: 'hardcoded' }, true)
      );
      const disabled = await renderFields(
        makePayload({ value: 'always', source: 'hardcoded' }, false)
      );

      const enabledField = enabled.find(f => f.name.includes('Character voice'));
      const disabledField = disabled.find(f => f.name.includes('Character voice'));
      expect(enabledField?.value).toContain('✅ Enabled');
      expect(enabledField?.value).toContain('creator');
      expect(disabledField?.value).toContain('❌ Disabled');
    });

    it.each([
      { value: 'always', source: 'hardcoded', expected: 'built-in default' },
      {
        value: 'voice-only',
        source: 'user-personality',
        expected: 'your override for this character',
      },
      { value: 'never', source: 'channel', expected: "this channel's setting" },
      { value: 'voice-only', source: 'user-default', expected: 'your default for every character' },
      { value: 'always', source: 'admin', expected: 'bot-wide setting' },
      { value: 'never', source: 'personality', expected: "the character's default" },
    ] as const)(
      'renders the exact cascade-source label for voiceResponseMode source=$source',
      async ({ value, source, expected }) => {
        // Pins every branch of the voice-mode source-label mapping to its exact
        // string — a dropped `case` arm or a reworded label fails the row.
        const fields = await renderFields(makePayload({ value, source }, true));
        const field = fields.find(f => f.name.includes('Voice replies'));
        expect(field?.value).toContain(expected);
      }
    );
  });

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
