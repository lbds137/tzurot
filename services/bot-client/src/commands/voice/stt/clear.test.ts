/**
 * Tests for /voice stt clear handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  clearSttDefaultProvider: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const { handleSttClear } = await import('./clear.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleSttClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.clearSttDefaultProvider.mockReset();
  });

  it('calls clearSttDefaultProvider', async () => {
    stub.clearSttDefaultProvider.mockResolvedValue(makeOk({ deleted: true, wasSet: true }));

    await handleSttClear(makeContext() as never);

    expect(stub.clearSttDefaultProvider).toHaveBeenCalled();
  });

  it('reports gateway error', async () => {
    stub.clearSttDefaultProvider.mockResolvedValue(makeErr(500, 'oh no'));
    const context = makeContext();

    await handleSttClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('oh no'),
    });
  });
});
