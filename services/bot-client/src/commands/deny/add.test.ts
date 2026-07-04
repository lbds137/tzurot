import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAdd } from './add.js';
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
  addDenylistEntry: ReturnType<typeof vi.fn>;
}

function createStub(): OwnerStub {
  return { addDenylistEntry: vi.fn() };
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

describe('handleAdd', () => {
  let stub: OwnerStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  it('should add a bot-wide user denial', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ target: '999888777', type: 'USER', scope: 'BOT' });

    await handleAdd(context);

    expect(stub.addDenylistEntry).toHaveBeenCalledWith({
      type: 'USER',
      discordId: '999888777',
      scope: 'BOT',
      scopeId: '*',
      mode: 'BLOCK',
      reason: undefined,
    });
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ User <@999888777> (`999888777`) denied (bot-wide).'
    );
  });

  it('should add a channel-scoped denial with reason', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'chan-123' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      target: '999888777',
      scope: 'CHANNEL',
      reason: 'Spam',
    });

    await handleAdd(context);

    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'CHANNEL',
        scopeId: 'chan-123',
        reason: 'Spam',
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ User <@999888777> (`999888777`) denied (channel-scoped).'
    );
  });

  it('should reject GUILD type with non-BOT scope', async () => {
    const context = createMockContext({ target: '111222333', type: 'GUILD', scope: 'CHANNEL' });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Server denials only support Bot scope.');
    expect(checkDenyPermission).not.toHaveBeenCalled();
  });

  it('should stop when permission denied', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: false, scopeId: '' });
    const context = createMockContext({ target: '999888777' });

    await handleAdd(context);

    expect(stub.addDenylistEntry).not.toHaveBeenCalled();
  });

  it('should strip Discord mention wrapper from target', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ target: '<@999888777>' });

    await handleAdd(context);

    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: '999888777' })
    );
  });

  it('should strip nickname mention wrapper from target', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ target: '<@!999888777>' });

    await handleAdd(context);

    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: '999888777' })
    );
  });

  it('should handle API error', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeErr(400, 'Cannot deny the bot owner'));
    const context = createMockContext({ target: '999888777' });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Failed: Cannot deny the bot owner');
  });
});
