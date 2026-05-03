/**
 * Tests for /settings tts clear-default handler.
 * Smoke-tests happy path + gateway-error path.
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
  };
});

const { handleTtsClearDefault: handleClearDefault } = await import('./clear-default.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    editReply: vi.fn(),
  };
}

describe('handleClearDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hits DELETE /user/tts-override/default and shows success embed', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { deleted: true } });
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/tts-override/default',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Cleared') }),
          }),
        ],
      })
    );
  });

  it('shows error message on gateway failure', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'INTERNAL_ERROR' });
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });

  it('catches and reports unexpected errors', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('network down'));
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('error occurred') })
    );
  });
});
