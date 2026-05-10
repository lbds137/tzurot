/**
 * Tests for /voice provider clear handler.
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
  };
});

const { handleProviderClear } = await import('./clear.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleProviderClear', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DELETEs /user/voice-provider', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, wasSet: true },
    });

    await handleProviderClear(makeContext() as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voice-provider',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('reports gateway error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'nope' });
    const context = makeContext();

    await handleProviderClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('nope'),
    });
  });
});
