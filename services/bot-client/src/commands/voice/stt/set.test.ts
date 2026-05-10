/**
 * Tests for /voice stt set handler.
 * Locks the per-personality STT override write flow (Layer 1).
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
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    voiceSttSetOptions: vi.fn(() => ({
      personality: () => 'personality-uuid-1',
      provider: () => 'mistral',
    })),
  };
});

vi.mock('../../../utils/apiCheck.js', () => ({
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE: '⚠️ Autocomplete unavailable',
  isAutocompleteErrorSentinel: vi.fn(() => false),
}));

const { handleSttSet } = await import('./set.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleSttSet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PUTs /user/stt-override on happy path', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        override: {
          personalityId: 'personality-uuid-1',
          personalityName: 'Alice',
          providerId: 'mistral',
        },
      },
    });
    const context = makeContext();

    await handleSttSet(context as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/stt-override',
      expect.objectContaining({
        method: 'PUT',
        body: { personalityId: 'personality-uuid-1', providerId: 'mistral' },
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it('reports error when gateway returns failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'boom',
    });
    const context = makeContext();

    await handleSttSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('boom'),
    });
  });
});
