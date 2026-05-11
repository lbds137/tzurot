/**
 * Tests for /voice tts set handler.
 * Locks the BYOK gate + per-character TTS override flow.
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
      character: () => 'personality-uuid-1',
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

describe('handleTtsSet', () => {
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
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        override: {
          personalityId: 'personality-uuid-1',
          personalityName: 'Alice',
          configId: 'cfg-uuid-1',
          configName: 'kyutai-self-hosted',
        },
      },
    });
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
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'INTERNAL_ERROR' });
    const context = makeContext();

    await handleSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });
});
