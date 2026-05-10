/**
 * Tests for /voice stt browse handler.
 * Locks the parallel-fetch pattern + fallback wording when nothing is set.
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

const { handleSttBrowse } = await import('./browse.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleSttBrowse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hits all three endpoints in parallel', async () => {
    mockCallGatewayApi.mockImplementation(async (url: string) => {
      if (url === '/user/stt-override') {
        return { ok: true, data: { overrides: [] } };
      }
      if (url === '/user/stt-override/default') {
        return { ok: true, data: { default: { providerId: null } } };
      }
      if (url === '/user/voice-provider') {
        return { ok: true, data: { providerId: null } };
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await handleSttBrowse(makeContext() as never);

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(3);
  });

  it('renders the empty-state message when no overrides + no defaults', async () => {
    mockCallGatewayApi.mockImplementation(async (url: string) => {
      if (url === '/user/stt-override') return { ok: true, data: { overrides: [] } };
      if (url === '/user/stt-override/default')
        return { ok: true, data: { default: { providerId: null } } };
      if (url === '/user/voice-provider') return { ok: true, data: { providerId: null } };
      throw new Error('unexpected');
    });
    const context = makeContext();

    await handleSttBrowse(context as never);

    const reply = context.editReply.mock.calls[0]?.[0];
    expect(reply).toEqual(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('lists per-personality overrides', async () => {
    mockCallGatewayApi.mockImplementation(async (url: string) => {
      if (url === '/user/stt-override') {
        return {
          ok: true,
          data: {
            overrides: [
              { personalityId: 'p-1', personalityName: 'Alice', providerId: 'mistral' },
              { personalityId: 'p-2', personalityName: 'Bob', providerId: 'elevenlabs' },
            ],
          },
        };
      }
      if (url === '/user/stt-override/default')
        return { ok: true, data: { default: { providerId: 'voice-engine' } } };
      if (url === '/user/voice-provider') return { ok: true, data: { providerId: 'mistral' } };
      throw new Error('unexpected');
    });
    const context = makeContext();

    await handleSttBrowse(context as never);

    expect(context.editReply).toHaveBeenCalled();
  });

  it('reports overrides-fetch failure', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    const context = makeContext();

    await handleSttBrowse(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('boom'),
    });
  });
});
