/**
 * Tests for /voice replies handler.
 * Locks the write seam (updatePersonalityOverrides carries the chosen mode),
 * the confirmation render from the extended voice-resolution read, and the
 * voice-disabled warn line.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  updatePersonalityOverrides: vi.fn(),
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
    voiceRepliesOptions: vi.fn(() => ({
      character: () => 'personality-uuid-1',
      mode: () => 'voice-only',
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

const { handleVoiceReplies } = await import('./replies.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: { channelId: 'channel-42' } as never,
    editReply: vi.fn(),
  };
}

/** The extended voice-resolution read the confirmation renders from. */
const resolutionPayload = (
  voiceEnabled: boolean,
  value = 'voice-only',
  source = 'user-personality'
) =>
  makeOk({
    personalityName: 'Aurora',
    voiceEnabled,
    voiceResponseMode: { value, source },
    tts: {
      configId: null,
      configName: null,
      provider: 'self-hosted',
      source: 'hardcoded',
    },
    stt: { provider: 'voice-engine', source: 'hardcoded' },
    voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
  });

describe('handleVoiceReplies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.updatePersonalityOverrides.mockReset();
    stub.getVoiceResolution.mockReset();
    stub.updatePersonalityOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
    stub.getVoiceResolution.mockResolvedValue(resolutionPayload(true));
  });

  it('writes the per-character tier via updatePersonalityOverrides with the chosen mode', async () => {
    await handleVoiceReplies(makeContext() as never);

    expect(stub.updatePersonalityOverrides).toHaveBeenCalledWith('personality-uuid-1', {
      voiceResponseMode: 'voice-only',
    });
  });

  it('confirms from the extended read, showing the freshly written override', async () => {
    // user-personality is the only source reachable right after the write:
    // the just-written tier wins the read-back's resolution.
    stub.getVoiceResolution.mockResolvedValue(
      resolutionPayload(true, 'voice-only', 'user-personality')
    );

    const context = makeContext();
    await handleVoiceReplies(context as never);

    expect(stub.getVoiceResolution).toHaveBeenCalledWith({
      personalityId: 'personality-uuid-1',
      channelId: 'channel-42',
      skipVoices: 'true',
    });

    const reply = context.editReply.mock.calls[0]?.[0];
    expect(reply.content).toContain('Voice replies for');
    expect(reply.content).toContain('Aurora');
    // Human labels, not raw enum values — value and source both labeled.
    expect(reply.content).toContain('Only when you send voice');
    expect(reply.content).toContain('your override for this character');
    expect(reply.embeds).toBeUndefined();
  });

  it('warns when the character has no voice enabled', async () => {
    stub.getVoiceResolution.mockResolvedValue(resolutionPayload(false));

    const context = makeContext();
    await handleVoiceReplies(context as never);

    const reply = context.editReply.mock.calls[0]?.[0];
    expect(reply.content).toContain('voice enabled by its creator');
  });

  it('does not warn when the character has voice enabled', async () => {
    const context = makeContext();
    await handleVoiceReplies(context as never);

    const reply = context.editReply.mock.calls[0]?.[0];
    expect(reply.content).not.toContain('voice enabled by its creator');
  });

  it('still confirms in plain text when the post-write resolution read fails', async () => {
    stub.getVoiceResolution.mockResolvedValue(makeErr(500, 'oops'));

    const context = makeContext();
    await handleVoiceReplies(context as never);

    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    // The write applied; only the read-back failed — no duplicate-save invitation.
    expect(content).toContain("couldn't read the confirmation back");
    expect(content).toContain('no need to save again');
  });

  it('falls back to committedUnconfirmed when read-back returns a stale mode value', async () => {
    stub.getVoiceResolution.mockResolvedValue(
      resolutionPayload(true, 'always', 'user-personality')
    );

    const context = makeContext();
    await handleVoiceReplies(context as never);

    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    expect(content).toContain("couldn't read the confirmation back");
    expect(content).toContain('no need to save again');
    expect(content).not.toContain('Always');
    expect(content).not.toContain('Aurora');
  });

  it('falls back to committedUnconfirmed when read-back returns a stale source', async () => {
    stub.getVoiceResolution.mockResolvedValue(resolutionPayload(true, 'voice-only', 'channel'));

    const context = makeContext();
    await handleVoiceReplies(context as never);

    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    expect(content).toContain("couldn't read the confirmation back");
    expect(content).toContain('no need to save again');
    expect(content).not.toContain("this channel's setting");
    expect(content).not.toContain('Aurora');
  });

  it('returns early with AUTOCOMPLETE_UNAVAILABLE_MESSAGE on autocomplete sentinel', async () => {
    const apiCheck = await import('../../utils/apiCheck.js');
    vi.mocked(apiCheck.isAutocompleteErrorSentinel).mockReturnValueOnce(true);

    const context = makeContext();
    await handleVoiceReplies(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: apiCheck.AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
    });
    expect(stub.updatePersonalityOverrides).not.toHaveBeenCalled();
    expect(stub.getVoiceResolution).not.toHaveBeenCalled();
  });

  it('catches a thrown write error and replies with classified failure copy', async () => {
    stub.updatePersonalityOverrides.mockRejectedValueOnce(new Error('network timeout'));

    const context = makeContext();
    await handleVoiceReplies(context as never);

    expect(stub.getVoiceResolution).not.toHaveBeenCalled();
    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    expect(content).toContain('Failed to set voice replies.');
    expect(content).not.toContain('network timeout');
  });

  it('reports a failed write without reading the resolution', async () => {
    stub.updatePersonalityOverrides.mockResolvedValue(makeErr(400, 'bad request'));

    const context = makeContext();
    await handleVoiceReplies(context as never);

    expect(stub.getVoiceResolution).not.toHaveBeenCalled();
    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    // The gateway's own rejection message crosses the seam.
    expect(content).toContain('bad request');
  });

  it('rejects a mode outside the subcommand choices before any write', async () => {
    const { voiceRepliesOptions } = await import('@tzurot/common-types/generated/commandOptions');
    vi.mocked(voiceRepliesOptions).mockReturnValueOnce({
      character: () => 'personality-uuid-1',
      mode: () => 'sometimes',
    } as never);

    const context = makeContext();
    await handleVoiceReplies(context as never);

    expect(stub.updatePersonalityOverrides).not.toHaveBeenCalled();
    const { content } = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    expect(content).toContain('Unknown voice reply mode');
  });
});
