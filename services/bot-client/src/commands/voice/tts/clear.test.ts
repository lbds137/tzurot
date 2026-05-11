/**
 * Tests for /voice tts clear handler.
 * Verifies the per-personality clear flow + idempotent wasSet messaging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
}));

vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: mockCallGatewayApi,
  toGatewayUser: vi.fn(user => ({ id: user.id })),
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
    voiceTtsClearOptions: vi.fn(() => ({
      character: () => 'personality-uuid-1',
    })),
  };
});

vi.mock('../../../utils/apiCheck.js', () => ({
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE: '⚠️ Autocomplete unavailable',
  isAutocompleteErrorSentinel: vi.fn(() => false),
}));

const { handleTtsClear: handleClear } = await import('./clear.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleTtsClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows success embed when an override was actually removed', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { deleted: true } });
    const context = makeContext();

    await handleClear(context as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      expect.stringContaining('/user/tts-override/'),
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Removed') }),
          }),
        ],
      })
    );
  });

  it('shows info embed when no override was set (wasSet: false)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, wasSet: false },
    });
    const context = makeContext();

    await handleClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('No Override') }),
          }),
        ],
      })
    );
  });

  it('shows error message on gateway failure', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'INTERNAL_ERROR' });
    const context = makeContext();

    await handleClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });
});
