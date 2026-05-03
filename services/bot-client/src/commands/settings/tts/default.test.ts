/**
 * Tests for /settings tts default handler.
 * Locks the BYOK-gate-then-mutation flow.
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
    settingsTtsDefaultOptions: vi.fn(() => ({
      tts: () => 'cfg-uuid-1',
    })),
  };
});

const { handleTtsDefault: handleDefault } = await import('./default.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks at command time when BYOK gate fails', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: true, reason: 'blocked-byok' });
    const context = makeContext();

    await handleDefault(context as never);

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('PUTs /user/tts-override/default on happy path', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'self-hosted' });
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { default: { configId: 'cfg-uuid-1', configName: 'kyutai-self-hosted' } },
    });
    const context = makeContext();

    await handleDefault(context as never);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/tts-override/default',
      expect.objectContaining({
        method: 'PUT',
        body: { configId: 'cfg-uuid-1' },
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Default TTS') }),
          }),
        ],
      })
    );
  });

  it('shows error embed on gateway failure', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'INTERNAL_ERROR' });
    const context = makeContext();

    await handleDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });
});
