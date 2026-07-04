import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRemove } from './remove.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { makeOk, makeErr, asOwnerClient } from '../../test/gatewayClientStubs.js';

// Mock dependencies
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    })),
  };
});

vi.mock('./permissions.js', () => ({
  checkDenyPermission: vi.fn(),
}));

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

import { checkDenyPermission } from './permissions.js';

interface OwnerStub {
  removeDenylistEntry: ReturnType<typeof vi.fn>;
}

function createStub(): OwnerStub {
  return { removeDenylistEntry: vi.fn() };
}

function createMockContext(options: Record<string, unknown> = {}): DeferredCommandContext {
  const optionMap = new Map(Object.entries(options));
  return {
    user: { id: 'user-123' },
    guildId: 'guild-456',
    interaction: {
      user: { id: 'user-123' },
      options: {
        getChannel: vi.fn().mockReturnValue(options.channel ?? null),
      },
    },
    getOption: vi.fn((name: string) => optionMap.get(name) ?? null),
    getRequiredOption: vi.fn((name: string) => optionMap.get(name)),
    editReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

describe('handleRemove', () => {
  let stub: OwnerStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  it('should remove a denial entry', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ target: '999888777', type: 'USER', scope: 'BOT' });

    await handleRemove(context);

    expect(stub.removeDenylistEntry).toHaveBeenCalledWith('USER', '999888777', 'BOT', '*');
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denial removed for <@999888777> (`999888777`) (bot scope).'
    );
  });

  it('should handle not found', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.removeDenylistEntry.mockResolvedValue(makeErr(404, 'Not found'));
    const context = createMockContext({ target: '999888777' });

    await handleRemove(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ No matching denial entry found.');
  });

  it('should strip Discord mention wrapper from target', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ target: '<@999888777>' });

    await handleRemove(context);

    expect(stub.removeDenylistEntry).toHaveBeenCalledWith('USER', '999888777', 'BOT', '*');
  });

  it('should stop when permission denied', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: false, scopeId: '' });
    const context = createMockContext({ target: '999888777' });

    await handleRemove(context);

    expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
  });
});
