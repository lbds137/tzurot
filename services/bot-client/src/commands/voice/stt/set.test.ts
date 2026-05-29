/**
 * Tests for /voice stt set handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/common-types';

const stub = {
  setSttDefaultProvider: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
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
  beforeEach(() => {
    vi.clearAllMocks();
    stub.setSttDefaultProvider.mockReset();
  });

  it('calls setSttDefaultProvider with the provider and shows the success embed', async () => {
    stub.setSttDefaultProvider.mockResolvedValue(
      makeOk({ default: { providerId: 'voice-engine' } })
    );
    const context = makeContext();

    await handleSttSet(context as never);

    expect(stub.setSttDefaultProvider).toHaveBeenCalledWith({ providerId: 'voice-engine' });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it('reports gateway error', async () => {
    stub.setSttDefaultProvider.mockResolvedValue(makeErr(500, 'oops'));
    const context = makeContext();

    await handleSttSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('oops'),
    });
  });
});
