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

/** Stand-in for the resolved User a native `user:` option hands the handler. */
const TARGET_USER = { id: '999888777', username: 'lbds137', displayName: 'Vlad' };

interface MockContextInput {
  /** The scope subcommand name (`everywhere` | `server` | `this-server` | `channel` | `character`). */
  subcommand?: string | null;
  user?: { id: string; username: string; displayName: string } | null;
  channel?: { id: string } | null;
  options?: Record<string, unknown>;
}

function createMockContext(input: MockContextInput = {}): DeferredCommandContext {
  const optionMap = new Map(Object.entries(input.options ?? {}));
  return {
    user: { id: 'user-123' },
    guildId: 'guild-456',
    interaction: {
      user: { id: 'user-123' },
      options: {
        getUser: vi.fn().mockReturnValue(input.user ?? null),
        getChannel: vi.fn().mockReturnValue(input.channel ?? null),
      },
    },
    getSubcommand: vi.fn(() => input.subcommand ?? 'everywhere'),
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

  it('removes a bot-wide user denial derived from the everywhere subcommand', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ subcommand: 'everywhere', user: TARGET_USER });

    await handleRemove(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'BOT', null, null);
    expect(stub.removeDenylistEntry).toHaveBeenCalledWith('USER', '999888777', 'BOT', '*');
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denial removed for **Vlad** (@lbds137 · `999888777`) everywhere (every server and DM).'
    );
  });

  it('removes a server denial derived from the server subcommand', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'server',
      options: { server: '111222333' },
    });

    await handleRemove(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'BOT', null, null);
    expect(stub.removeDenylistEntry).toHaveBeenCalledWith('GUILD', '111222333', 'BOT', '*');
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denial removed for server `111222333` everywhere (every server and DM).'
    );
  });

  it('derives CHANNEL scope from the channel subcommand', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'chan-123' });
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'channel',
      user: TARGET_USER,
      channel: { id: 'chan-123' },
    });

    await handleRemove(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'CHANNEL', 'chan-123', null);
    expect(stub.removeDenylistEntry).toHaveBeenCalledWith(
      'USER',
      '999888777',
      'CHANNEL',
      'chan-123'
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denial removed for **Vlad** (@lbds137 · `999888777`) in <#chan-123>.'
    );
  });

  it('derives PERSONALITY scope from the character subcommand', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'pers-1' });
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'character',
      user: TARGET_USER,
      options: { character: 'lilith' },
    });

    await handleRemove(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'PERSONALITY', null, 'lilith');
    expect(stub.removeDenylistEntry).toHaveBeenCalledWith(
      'USER',
      '999888777',
      'PERSONALITY',
      'pers-1'
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denial removed for **Vlad** (@lbds137 · `999888777`) for the character **lilith**.'
    );
  });

  it('should handle not found', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.removeDenylistEntry.mockResolvedValue(makeErr(404, 'Not found'));
    const context = createMockContext({ subcommand: 'everywhere', user: TARGET_USER });

    await handleRemove(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Denial entry not found.');
  });

  it('rejects when neither user nor server is supplied', async () => {
    const context = createMockContext({ subcommand: 'everywhere' });

    await handleRemove(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('No target supplied'));
    expect(checkDenyPermission).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised scope subcommand', async () => {
    const context = createMockContext({ subcommand: 'nonsense', user: TARGET_USER });

    await handleRemove(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Unknown denial scope'));
    expect(checkDenyPermission).not.toHaveBeenCalled();
  });

  it('should stop when permission denied', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: false, scopeId: '' });
    const context = createMockContext({ subcommand: 'everywhere', user: TARGET_USER });

    await handleRemove(context);

    expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
  });
});
