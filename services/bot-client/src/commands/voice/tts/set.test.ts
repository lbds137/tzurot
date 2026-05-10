/**
 * Tests for /voice tts set handler.
 * Locks the BYOK gate, per-personality override flow, and the smart JIT
 * footer that fires when a TTS choice cascades into a different STT provider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi, mockCheckTtsByokAccess } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
  mockCheckTtsByokAccess: vi.fn(),
}));

vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: mockCallGatewayApi,
  toGatewayUser: vi.fn(user => ({ id: user.id })),
}));

vi.mock('./guestModeValidation.js', () => ({
  checkTtsByokAccess: mockCheckTtsByokAccess,
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    voiceTtsSetOptions: vi.fn(() => ({
      personality: () => 'personality-uuid-1',
      tts: () => 'cfg-uuid-1',
    })),
  };
});

vi.mock('../../../utils/apiCheck.js', () => ({
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE: '⚠️ Autocomplete unavailable',
  isAutocompleteErrorSentinel: vi.fn(() => false),
}));

const { handleTtsSet: handleSet } = await import('./set.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

interface MockOptions {
  /** Pre-write resolved STT provider. */
  oldStt?: { provider: string; source: string } | null;
  /** Post-write resolved STT provider. */
  newStt?: { provider: string; source: string } | null;
  /** Override the PUT /user/tts-override response. */
  setResponse?: { ok: true; data: unknown } | { ok: false; status: number; error: string };
}

/**
 * Sequenced gateway-mock: the handler hits 3 endpoints in fixed order
 * (resolution-pre, PUT override, resolution-post). Routes by URL prefix
 * so call ordering stays explicit in test setup.
 */
function setupGateway(opts: MockOptions = {}) {
  const oldStt = opts.oldStt ?? { provider: 'voice-engine', source: 'hardcoded' };
  const newStt = opts.newStt ?? oldStt;
  const setResponse: { ok: true; data: unknown } | { ok: false; status: number; error: string } =
    opts.setResponse ?? {
      ok: true,
      data: {
        override: {
          personalityId: 'personality-uuid-1',
          personalityName: 'Alice',
          configId: 'cfg-uuid-1',
          configName: 'kyutai-self-hosted',
        },
      },
    };

  let resolutionCalls = 0;
  mockCallGatewayApi.mockImplementation(async (url: string) => {
    if (url.startsWith('/user/voice-resolution')) {
      const stt = resolutionCalls === 0 ? oldStt : newStt;
      resolutionCalls++;
      return {
        ok: true,
        data: {
          tts: { configId: null, configName: null, provider: 'self-hosted', source: 'hardcoded' },
          stt,
          voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
        },
      };
    }
    if (url === '/user/tts-override') {
      return setResponse;
    }
    throw new Error(`Unexpected gateway URL: ${url}`);
  });
}

describe('handleSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks at command time when BYOK gate fails', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: true, reason: 'blocked-byok' });
    const context = makeContext();

    await handleSet(context as never);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('PUTs /user/tts-override on happy path', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    setupGateway();
    const context = makeContext();

    await handleSet(context as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/tts-override',
      expect.objectContaining({
        method: 'PUT',
        body: { personalityId: 'personality-uuid-1', configId: 'cfg-uuid-1' },
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Set') }),
          }),
        ],
      })
    );
  });

  it('shows error embed on gateway failure', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    setupGateway({ setResponse: { ok: false, status: 500, error: 'INTERNAL_ERROR' } });
    const context = makeContext();

    await handleSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });

  it('fires JIT footer when TTS choice cascades into a new STT provider via tts-derived', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    setupGateway({
      oldStt: { provider: 'voice-engine', source: 'hardcoded' },
      newStt: { provider: 'mistral', source: 'tts-derived' },
    });
    const context = makeContext();

    await handleSet(context as never);

    const reply = context.editReply.mock.calls[0]?.[0] as {
      embeds: Array<{ data: { footer?: { text: string } } }>;
    };
    const footer = reply.embeds[0].data.footer?.text ?? '';
    expect(footer).toContain('STT now resolves');
    expect(footer).toContain('Mistral');
  });

  it('does NOT fire JIT footer when STT source is not tts-derived (e.g. user has Layer 1 override)', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    setupGateway({
      oldStt: { provider: 'elevenlabs', source: 'user-personality' },
      newStt: { provider: 'elevenlabs', source: 'user-personality' },
    });
    const context = makeContext();

    await handleSet(context as never);

    const reply = context.editReply.mock.calls[0]?.[0] as {
      embeds: Array<{ data: { footer?: { text: string } } }>;
    };
    const footer = reply.embeds[0].data.footer?.text ?? '';
    expect(footer).not.toContain('STT now resolves');
    expect(footer).toContain('Use /voice tts clear');
  });

  it('still surfaces TTS-set success when post-write fetchStt throws (best-effort footer)', async () => {
    // Regression: an unhandled exception on the post-write resolution call
    // would previously trip the outer try/catch and show "❌ An error occurred"
    // even though the TTS write had succeeded.
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    let callIdx = 0;
    mockCallGatewayApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/user/voice-resolution')) {
        // Pre-write succeeds; post-write throws (network exception).
        if (callIdx++ === 0) {
          return {
            ok: true,
            data: {
              tts: {
                configId: null,
                configName: null,
                provider: 'self-hosted',
                source: 'hardcoded',
              },
              stt: { provider: 'voice-engine', source: 'hardcoded' },
              voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
            },
          };
        }
        throw new Error('ECONNRESET');
      }
      // /user/tts-override succeeds.
      return {
        ok: true,
        data: {
          override: {
            personalityId: 'personality-uuid-1',
            personalityName: 'Alice',
            configId: 'cfg-uuid-1',
            configName: 'kyutai-self-hosted',
          },
        },
      };
    });
    const context = makeContext();

    await handleSet(context as never);

    const reply = context.editReply.mock.calls[0]?.[0] as {
      embeds?: Array<{ data: { title?: string; footer?: { text: string } } }>;
      content?: string;
    };
    // Should show the success embed (not the generic error string)
    expect(reply.embeds?.[0].data.title).toContain('Set');
    expect(reply.content).toBeUndefined();
    // Footer falls back to the default since post-write snapshot was null
    expect(reply.embeds?.[0].data.footer?.text).toContain('Use /voice tts clear');
  });

  it('does NOT fire JIT footer when STT provider is unchanged across the write', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    setupGateway({
      oldStt: { provider: 'mistral', source: 'tts-derived' },
      newStt: { provider: 'mistral', source: 'tts-derived' },
    });
    const context = makeContext();

    await handleSet(context as never);

    const reply = context.editReply.mock.calls[0]?.[0] as {
      embeds: Array<{ data: { footer?: { text: string } } }>;
    };
    const footer = reply.embeds[0].data.footer?.text ?? '';
    expect(footer).not.toContain('STT now resolves');
  });
});
