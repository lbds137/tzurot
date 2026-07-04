/**
 * Tests for /voice stt set handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  setSttDefaultProvider: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    voiceSttSetOptions: vi.fn(() => ({
      provider: () => 'voice-engine',
    })),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
