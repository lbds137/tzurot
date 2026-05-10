/**
 * Tests for /voice stt set-default handler.
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
    voiceSttSetDefaultOptions: vi.fn(() => ({
      provider: () => 'voice-engine',
    })),
  };
});

const { handleSttSetDefault } = await import('./set-default.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleSttSetDefault', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PUTs /user/stt-override/default with the provider', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { default: { providerId: 'voice-engine' } },
    });

    await handleSttSetDefault(makeContext() as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/stt-override/default',
      expect.objectContaining({
        method: 'PUT',
        body: { providerId: 'voice-engine' },
      })
    );
  });

  it('reports gateway error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'oops' });
    const context = makeContext();

    await handleSttSetDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('oops'),
    });
  });
});
