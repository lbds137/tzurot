/**
 * Tests for /admin broadcast handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import type { OwnerClient } from '@tzurot/clients';

const stub = {
  broadcast: vi.fn(),
};

const optionValues = {
  message: 'hello users',
  level: null as string | null,
  label: null as string | null,
  dryRun: null as boolean | null,
  confirm: null as boolean | null,
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ ownerClient: stub as unknown as OwnerClient })),
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    adminBroadcastOptions: vi.fn(() => ({
      message: () => optionValues.message,
      level: () => optionValues.level,
      label: () => optionValues.label,
      'dry-run': () => optionValues.dryRun,
      confirm: () => optionValues.confirm,
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

const { handleBroadcast } = await import('./broadcast.js');

function makeContext() {
  return {
    user: { id: 'owner-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.broadcast.mockReset();
    optionValues.message = 'hello users';
    optionValues.level = null;
    optionValues.label = null;
    optionValues.dryRun = null;
    optionValues.confirm = null;
  });

  it('blocks an unconfirmed real send locally with the preview guidance', async () => {
    const context = makeContext();

    await handleBroadcast(context as never);

    expect(stub.broadcast).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('confirm:true'),
    });
  });

  it('defaults to level major, no label, real run', async () => {
    optionValues.confirm = true;
    stub.broadcast.mockResolvedValue(
      makeOk({
        dryRun: false,
        version: 'adhoc-x',
        releaseId: '123e4567-e89b-42d3-a456-426614174000',
        recipients: 2,
        batches: 1,
      })
    );
    const context = makeContext();

    await handleBroadcast(context as never);

    expect(stub.broadcast).toHaveBeenCalledWith({
      message: 'hello users',
      level: 'major',
      label: undefined,
      dryRun: false,
      confirm: true,
    });
    const call = context.editReply.mock.calls[0][0] as { embeds: { data: { title?: string } }[] };
    expect(call.embeds[0].data.title).toContain('enqueued');
  });

  it('renders the dry-run audience preview', async () => {
    optionValues.dryRun = true;
    optionValues.level = 'patch';
    stub.broadcast.mockResolvedValue(
      makeOk({ dryRun: true, eligibleCount: 3, sample: [{ username: 'alice' }] })
    );
    const context = makeContext();

    await handleBroadcast(context as never);

    expect(stub.broadcast).toHaveBeenCalledWith({
      message: 'hello users',
      level: 'patch',
      label: undefined,
      dryRun: true,
      confirm: false,
    });
    const call = context.editReply.mock.calls[0][0] as {
      embeds: { data: { title?: string; description?: string } }[];
    };
    expect(call.embeds[0].data.title).toContain('dry run');
    expect(call.embeds[0].data.description).toContain('**3**');
    expect(JSON.stringify(call.embeds[0].data)).toContain('alice');
  });

  it('surfaces a gateway rejection (e.g. duplicate label)', async () => {
    optionValues.confirm = true;
    stub.broadcast.mockResolvedValue(makeErr(400, 'Version "x" was already announced'));
    const context = makeContext();

    await handleBroadcast(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already announced'),
    });
  });

  it('falls back to the generic error on a thrown failure', async () => {
    optionValues.confirm = true;
    stub.broadcast.mockRejectedValue(new Error('network'));
    const context = makeContext();

    await handleBroadcast(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to enqueue the broadcast'),
    });
  });
});
