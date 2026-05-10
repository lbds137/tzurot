/**
 * Tests for /voice stt set handler.
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
      provider: () => 'voice-engine',
    })),
  };
});

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

  it('PUTs /user/stt-override with the provider and shows the success embed', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { default: { providerId: 'voice-engine' } },
    });
    const context = makeContext();

    await handleSttSet(context as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/stt-override',
      expect.objectContaining({
        method: 'PUT',
        body: { providerId: 'voice-engine' },
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it('reports gateway error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'oops' });
    const context = makeContext();

    await handleSttSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('oops'),
    });
  });
});
