/**
 * Tests for /voice provider set handler.
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
    voiceProviderSetOptions: vi.fn(() => ({
      provider: () => 'mistral',
    })),
  };
});

const { handleProviderSet } = await import('./set.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleProviderSet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PUTs /user/voice-provider with the provider id', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { providerId: 'mistral' },
    });

    await handleProviderSet(makeContext() as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voice-provider',
      expect.objectContaining({
        method: 'PUT',
        body: { providerId: 'mistral' },
      })
    );
  });

  it('reports gateway error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'fail' });
    const context = makeContext();

    await handleProviderSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('fail'),
    });
  });
});
