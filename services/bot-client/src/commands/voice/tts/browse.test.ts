/**
 * Tests for /voice tts browse handler.
 * Verifies override-list rendering for empty + populated cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
}));

vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: mockCallGatewayApi,
  toGatewayUser: vi.fn(user => ({ id: user.id })),
  GATEWAY_TIMEOUTS: { DEFERRED: 30000 },
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

const { handleTtsBrowseOverrides: handleBrowseOverrides } = await import('./browse.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    editReply: vi.fn(),
  };
}

describe('handleBrowseOverrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty-state guidance when no overrides', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: { overrides: [] } });
    const context = makeContext();

    await handleBrowseOverrides(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("haven't set"),
            }),
          }),
        ],
      })
    );
  });

  it('renders override list with personality+config names', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        overrides: [
          {
            personalityId: 'p1',
            personalityName: 'Alice',
            configId: 'c1',
            configName: 'kyutai-self-hosted',
          },
        ],
      },
    });
    const context = makeContext();

    await handleBrowseOverrides(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('Alice'),
            }),
          }),
        ],
      })
    );
  });

  it('shows error message on gateway failure', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'INTERNAL_ERROR' });
    const context = makeContext();

    await handleBrowseOverrides(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
  });
});
