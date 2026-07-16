/**
 * Tests for /notifications cleanup — the seams that matter: ledger list →
 * Discord deletes (10008-tolerant) → stamp-back, and the partial-failure copy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordAPIError } from 'discord.js';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  listReleaseDms: vi.fn(),
  markReleaseDmsDeleted: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
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

const { handleNotificationsCleanup } = await import('./cleanup.js');

const LOG_1 = '123e4567-e89b-42d3-a456-426614174001';
const LOG_2 = '123e4567-e89b-42d3-a456-426614174002';

function unknownMessageError() {
  return new DiscordAPIError(
    { code: 10008, message: 'Unknown Message' },
    10008,
    404,
    'DELETE',
    'url',
    {}
  );
}

function makeContext(deleteImpl?: (id: string) => Promise<void>) {
  const deleteMock = vi.fn(deleteImpl ?? (() => Promise.resolve()));
  const createDM = vi.fn().mockResolvedValue({ messages: { delete: deleteMock } });
  return {
    context: {
      user: { id: 'discord-user-1' },
      interaction: { user: { createDM } } as never,
      editReply: vi.fn(),
    },
    deleteMock,
    createDM,
  };
}

function repliedDescription(context: { editReply: ReturnType<typeof vi.fn> }): string {
  const call = context.editReply.mock.calls[0][0] as {
    embeds?: { data: { description?: string } }[];
    content?: string;
  };
  return call.embeds?.[0]?.data.description ?? call.content ?? '';
}

describe('handleNotificationsCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.listReleaseDms.mockReset();
    stub.markReleaseDmsDeleted.mockReset();
    stub.markReleaseDmsDeleted.mockResolvedValue(makeOk({ success: true, marked: 0 }));
  });

  it('deletes every standing DM and stamps the ledger', async () => {
    stub.listReleaseDms.mockResolvedValue(
      makeOk({
        messages: [
          { deliveryLogId: LOG_1, messageId: 'msg-1' },
          { deliveryLogId: LOG_2, messageId: 'msg-2' },
        ],
      })
    );
    const { context, deleteMock } = makeContext();

    await handleNotificationsCleanup(context as never);

    expect(deleteMock).toHaveBeenCalledWith('msg-1');
    expect(deleteMock).toHaveBeenCalledWith('msg-2');
    expect(stub.markReleaseDmsDeleted).toHaveBeenCalledWith({
      deliveryLogIds: [LOG_1, LOG_2],
    });
    expect(repliedDescription(context)).toContain('**2** release notifications');
  });

  it('replies nothing-to-clean without touching Discord when the ledger is empty', async () => {
    stub.listReleaseDms.mockResolvedValue(makeOk({ messages: [] }));
    const { context, createDM } = makeContext();

    await handleNotificationsCleanup(context as never);

    expect(createDM).not.toHaveBeenCalled();
    expect(stub.markReleaseDmsDeleted).not.toHaveBeenCalled();
    expect(repliedDescription(context)).toContain('Nothing to clean up');
  });

  it('counts a 10008 already-gone message as cleaned and stamps it', async () => {
    stub.listReleaseDms.mockResolvedValue(
      makeOk({ messages: [{ deliveryLogId: LOG_1, messageId: 'msg-1' }] })
    );
    const { context } = makeContext(() => Promise.reject(unknownMessageError()));

    await handleNotificationsCleanup(context as never);

    expect(stub.markReleaseDmsDeleted).toHaveBeenCalledWith({ deliveryLogIds: [LOG_1] });
    expect(repliedDescription(context)).toContain('**1** release notification');
  });

  it('skips a failing delete, stamps the rest, and reports the partial count', async () => {
    stub.listReleaseDms.mockResolvedValue(
      makeOk({
        messages: [
          { deliveryLogId: LOG_1, messageId: 'msg-1' },
          { deliveryLogId: LOG_2, messageId: 'msg-2' },
        ],
      })
    );
    const { context } = makeContext(id =>
      id === 'msg-1' ? Promise.reject(new Error('network reset')) : Promise.resolve()
    );

    await handleNotificationsCleanup(context as never);

    // Only the succeeded delete is stamped; the failed one stays standing.
    expect(stub.markReleaseDmsDeleted).toHaveBeenCalledWith({ deliveryLogIds: [LOG_2] });
    expect(repliedDescription(context)).toContain('**1** of 2');
  });

  it('renders a gateway failure without touching Discord', async () => {
    stub.listReleaseDms.mockResolvedValue(makeErr(500));
    const { context, createDM } = makeContext();

    await handleNotificationsCleanup(context as never);

    expect(createDM).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalled();
  });
});
