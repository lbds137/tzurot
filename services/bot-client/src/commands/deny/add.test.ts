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

describe('handleAdd', () => {
  let stub: OwnerStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  it('derives BOT scope and USER type from the everywhere subcommand and a filled user option', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ subcommand: 'everywhere', user: TARGET_USER });

    await handleAdd(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'BOT', null, null);
    expect(stub.addDenylistEntry).toHaveBeenCalledWith({
      type: 'USER',
      discordId: '999888777',
      scope: 'BOT',
      scopeId: '*',
      mode: 'BLOCK',
      reason: undefined,
    });
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denied **Vlad** (@lbds137 · `999888777`) everywhere (every server and DM) — blocked.'
    );
  });

  it('derives GUILD type from the server subcommand', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'server',
      options: { server: '111222333' },
    });

    await handleAdd(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'BOT', null, null);
    expect(stub.addDenylistEntry).toHaveBeenCalledWith({
      type: 'GUILD',
      discordId: '111222333',
      scope: 'BOT',
      scopeId: '*',
      mode: 'BLOCK',
      reason: undefined,
    });
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denied server `111222333` everywhere (every server and DM) — blocked.'
    );
  });

  it('derives GUILD scope from the this-server subcommand', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'guild-456' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({ subcommand: 'this-server', user: TARGET_USER });

    await handleAdd(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'GUILD', null, null);
    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'GUILD', scopeId: 'guild-456' })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denied **Vlad** (@lbds137 · `999888777`) in this server — blocked.'
    );
  });

  it('derives CHANNEL scope from the channel subcommand and forwards the channel id', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'chan-123' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'channel',
      user: TARGET_USER,
      channel: { id: 'chan-123' },
      options: { reason: 'Spam' },
    });

    await handleAdd(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'CHANNEL', 'chan-123', null);
    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'CHANNEL', scopeId: 'chan-123', reason: 'Spam' })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denied **Vlad** (@lbds137 · `999888777`) in <#chan-123> — blocked.'
    );
  });

  it('derives PERSONALITY scope from the character subcommand and forwards the character', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'pers-1' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'character',
      user: TARGET_USER,
      options: { character: 'lilith' },
    });

    await handleAdd(context);

    expect(checkDenyPermission).toHaveBeenCalledWith(context, 'PERSONALITY', null, 'lilith');
    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'PERSONALITY', scopeId: 'pers-1' })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denied **Vlad** (@lbds137 · `999888777`) for the character **lilith** — blocked.'
    );
  });

  it('reports mute mode in the confirmation', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const context = createMockContext({
      subcommand: 'everywhere',
      user: TARGET_USER,
      options: { mode: 'MUTE' },
    });

    await handleAdd(context);

    expect(stub.addDenylistEntry).toHaveBeenCalledWith(expect.objectContaining({ mode: 'MUTE' }));
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denied **Vlad** (@lbds137 · `999888777`) everywhere (every server and DM) — muted (ignored, but still kept in context).'
    );
  });

  it('rejects when neither user nor server is supplied', async () => {
    const context = createMockContext({ subcommand: 'everywhere' });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('No target supplied'));
    expect(checkDenyPermission).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised scope subcommand', async () => {
    const context = createMockContext({ subcommand: 'nonsense', user: TARGET_USER });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Unknown denial scope'));
    expect(checkDenyPermission).not.toHaveBeenCalled();
  });

  it('should stop when permission denied', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: false, scopeId: '' });
    const context = createMockContext({ subcommand: 'everywhere', user: TARGET_USER });

    await handleAdd(context);

    expect(stub.addDenylistEntry).not.toHaveBeenCalled();
  });

  it('should handle API error', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    stub.addDenylistEntry.mockResolvedValue(makeErr(400, 'Cannot deny the bot owner'));
    const context = createMockContext({ subcommand: 'everywhere', user: TARGET_USER });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Cannot deny the bot owner')
    );
  });
});
