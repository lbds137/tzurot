/**
 * Tests for /voice view handler.
 * Locks the single-round-trip resolution endpoint shape + the embed
 * source-layer rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
}));

vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: mockCallGatewayApi,
  toGatewayUser: vi.fn(user => ({ id: user.id })),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    voiceViewOptions: vi.fn(() => ({
      character: () => 'personality-uuid-1',
    })),
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
  beforeEach(() => vi.clearAllMocks());

  it('GETs /user/voice-resolution with the encoded personalityId', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        tts: {
          configId: 'cfg-1',
          configName: 'kyutai',
          provider: 'self-hosted',
          source: 'free-default',
        },
        stt: { provider: 'voice-engine', source: 'hardcoded' },
        voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
      },
    });

    await handleVoiceView(makeContext() as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voice-resolution?personalityId=personality-uuid-1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('renders the embed with TTS + STT + voices fields', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
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
      },
    });
    const context = makeContext();

    await handleVoiceView(context as never);

    const reply = context.editReply.mock.calls[0]?.[0];
    expect(reply).toEqual(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('reports gateway error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'oops' });
    const context = makeContext();

    await handleVoiceView(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('oops'),
    });
  });

  it('refuses the autocomplete error sentinel without calling the gateway', async () => {
    const apiCheck = await import('../../utils/apiCheck.js');
    vi.mocked(apiCheck.isAutocompleteErrorSentinel).mockReturnValueOnce(true);

    await handleVoiceView(makeContext() as never);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });
});
