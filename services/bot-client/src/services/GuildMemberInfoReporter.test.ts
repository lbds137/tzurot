import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Events, type Client, type GuildMember } from 'discord.js';
import { registerGuildMemberInfoReporter } from './GuildMemberInfoReporter.js';

const mockRecordGuildMemberInfo = vi.hoisted(() => vi.fn());
const mockRemoveGuildMemberInfo = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({
    recordGuildMemberInfo: mockRecordGuildMemberInfo,
    removeGuildMemberInfo: mockRemoveGuildMemberInfo,
  }),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const GUILD = '123456789012345678';

interface FakeRole {
  id: string;
  name: string;
  position: number;
}

function member(options: {
  roles: FakeRole[];
  color?: string;
  joinedAt?: Date;
  isBot?: boolean;
  partial?: boolean;
  id?: string;
}): GuildMember {
  return {
    id: options.id ?? '987654321098765432',
    partial: options.partial ?? false,
    guild: { id: GUILD },
    user: { bot: options.isBot ?? false },
    displayHexColor: options.color ?? '#000000',
    joinedAt: options.joinedAt ?? null,
    roles: { cache: new Map(options.roles.map(r => [r.id, r])) },
  } as unknown as GuildMember;
}

type UpdateHandler = (before: GuildMember, after: GuildMember) => void;
type RemoveHandler = (removed: GuildMember) => void;

/**
 * Register one reporter and expose fire functions for both listeners, sharing
 * the same `registerGuildMemberInfoReporter` closure — and therefore the same
 * per-member `inFlight` sequencing map.
 */
function register(): {
  update: UpdateHandler;
  remove: RemoveHandler;
} {
  const handlers = new Map<string, UpdateHandler | RemoveHandler>();
  const client = {
    on: (event: string, handler: UpdateHandler | RemoveHandler) => {
      handlers.set(event, handler);
    },
  } as unknown as Client;

  registerGuildMemberInfoReporter(client);

  return {
    update: (before, after) => {
      (handlers.get(Events.GuildMemberUpdate) as UpdateHandler | undefined)?.(before, after);
    },
    remove: removed => {
      (handlers.get(Events.GuildMemberRemove) as RemoveHandler | undefined)?.(removed);
    },
  };
}

function fireUpdate(before: GuildMember, after: GuildMember): void {
  register().update(before, after);
}

function fireRemove(removed: GuildMember): void {
  register().remove(removed);
}

const ADMIN: FakeRole = { id: 'role-1', name: 'Admin', position: 5 };
const MEMBER: FakeRole = { id: 'role-2', name: 'Member', position: 1 };

describe('registerGuildMemberInfoReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordGuildMemberInfo.mockResolvedValue({ ok: true });
    mockRemoveGuildMemberInfo.mockResolvedValue({ ok: true });
  });

  it('reports the extracted membership when a role changes', () => {
    fireUpdate(member({ roles: [MEMBER] }), member({ roles: [ADMIN, MEMBER] }));

    expect(mockRecordGuildMemberInfo).toHaveBeenCalledWith({
      guildId: GUILD,
      discordUserId: '987654321098765432',
      // Highest position first, and the @everyone role (whose id equals the
      // guild id) excluded — the same ordering the message path produces, so
      // whichever source writes last renders identical bytes.
      info: { roles: ['Admin', 'Member'], displayColor: undefined, joinedAt: undefined },
    });
  });

  it('skips an update that cannot change a rendered byte', () => {
    // guildMemberUpdate also fires for timeouts, avatars and pending flags.
    // Reporting those would be a round-trip and a write for no visible change.
    const roles = [ADMIN];
    fireUpdate(member({ roles }), member({ roles }));

    expect(mockRecordGuildMemberInfo).not.toHaveBeenCalled();
  });

  it('reports when the display colour changes but roles do not', () => {
    fireUpdate(member({ roles: [ADMIN] }), member({ roles: [ADMIN], color: '#FF00FF' }));

    expect(mockRecordGuildMemberInfo).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.objectContaining({ displayColor: '#FF00FF' }) })
    );
  });

  it('reports when `before` is a partial, having nothing to compare against', () => {
    fireUpdate(member({ roles: [], partial: true }), member({ roles: [ADMIN] }));

    expect(mockRecordGuildMemberInfo).toHaveBeenCalled();
  });

  it('ignores bots', () => {
    fireUpdate(member({ roles: [MEMBER] }), member({ roles: [ADMIN], isBot: true }));

    expect(mockRecordGuildMemberInfo).not.toHaveBeenCalled();
  });

  it('swallows a failed report rather than rejecting into the event loop', async () => {
    mockRecordGuildMemberInfo.mockRejectedValue(new Error('gateway down'));

    expect(() => fireUpdate(member({ roles: [] }), member({ roles: [ADMIN] }))).not.toThrow();
    await Promise.resolve();
  });

  it('logs a resolved gateway failure from the update report', async () => {
    mockRecordGuildMemberInfo.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 500,
      error: 'boom',
    });

    fireUpdate(member({ roles: [] }), member({ roles: [ADMIN] }));

    await vi.waitFor(() => {
      expect(mockLogger.warn).toHaveBeenCalled();
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD, status: 500 }),
      'Failed to report guild member update'
    );
    const [fields] = mockLogger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields.discordUserId).toBeUndefined();
    expect(JSON.stringify(fields)).not.toContain('987654321098765432');
  });

  it('logs nothing when the update report resolves ok', async () => {
    mockRecordGuildMemberInfo.mockResolvedValue({ ok: true, data: null });

    fireUpdate(member({ roles: [] }), member({ roles: [ADMIN] }));

    await Promise.resolve();
    await Promise.resolve();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  describe('guildMemberRemove', () => {
    it('reports the departure with both ids', () => {
      fireRemove(member({ roles: [MEMBER] }));

      expect(mockRemoveGuildMemberInfo).toHaveBeenCalledWith({
        guildId: GUILD,
        discordUserId: '987654321098765432',
      });
    });

    it('ignores a bot departure', () => {
      fireRemove(member({ roles: [MEMBER], isBot: true }));

      expect(mockRemoveGuildMemberInfo).not.toHaveBeenCalled();
    });

    it('still reports a partial member', () => {
      // `guildMemberRemove` delivers a partial for an uncached member.
      // discord.js' `PartialGuildMember` (typings/index.d.ts) is
      // `Partialize<GuildMember, 'joinedAt' | 'joinedTimestamp' | 'pending'>`,
      // so exactly those three fields are nulled. Everything this listener
      // reads — `guild`, `id`, and `user` — keeps its normal type.
      fireRemove(member({ roles: [], partial: true }));

      expect(mockRemoveGuildMemberInfo).toHaveBeenCalledWith({
        guildId: GUILD,
        discordUserId: '987654321098765432',
      });
    });

    it('swallows a client rejection rather than rejecting into the event loop', async () => {
      mockRemoveGuildMemberInfo.mockRejectedValue(new Error('gateway down'));

      expect(() => fireRemove(member({ roles: [MEMBER] }))).not.toThrow();
      await Promise.resolve();
    });

    it('logs a resolved gateway failure from the removal report', async () => {
      mockRemoveGuildMemberInfo.mockResolvedValue({
        ok: false,
        kind: 'http',
        status: 500,
        error: 'boom',
      });

      fireRemove(member({ roles: [MEMBER] }));

      await vi.waitFor(() => {
        expect(mockLogger.warn).toHaveBeenCalled();
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: GUILD, status: 500 }),
        'Failed to report guild member removal'
      );
    });

    it('logs nothing when the removal report resolves ok', async () => {
      mockRemoveGuildMemberInfo.mockResolvedValue({ ok: true, data: null });

      fireRemove(member({ roles: [MEMBER] }));

      await Promise.resolve();
      await Promise.resolve();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('per-member report sequencing', () => {
    it('delays a same-member delete until a pending update resolves', async () => {
      let resolveUpdate!: (value: unknown) => void;
      const deferred = new Promise(resolve => {
        resolveUpdate = resolve;
      });
      mockRecordGuildMemberInfo.mockReturnValue(deferred);

      const { update, remove } = register();
      const departed = member({ roles: [ADMIN] });
      update(member({ roles: [MEMBER] }), departed);
      remove(departed);

      await Promise.resolve();
      await Promise.resolve();
      expect(mockRemoveGuildMemberInfo).not.toHaveBeenCalled();

      resolveUpdate({ ok: true });
      await vi.waitFor(() => {
        expect(mockRemoveGuildMemberInfo).toHaveBeenCalled();
      });
    });

    it('does not delay a remove for a different member behind a pending update', () => {
      mockRecordGuildMemberInfo.mockReturnValue(new Promise(() => {}));

      const { update, remove } = register();
      update(
        member({ roles: [MEMBER], id: 'member-a' }),
        member({ roles: [ADMIN], id: 'member-a' })
      );
      remove(member({ roles: [MEMBER], id: 'member-b' }));

      expect(mockRemoveGuildMemberInfo).toHaveBeenCalledWith({
        guildId: GUILD,
        discordUserId: 'member-b',
      });
    });

    it('runs the remove for the same member after the update report rejects', async () => {
      mockRecordGuildMemberInfo.mockRejectedValue(new Error('gateway down'));

      const { update, remove } = register();
      const departed = member({ roles: [ADMIN] });
      update(member({ roles: [MEMBER] }), departed);
      remove(departed);

      await vi.waitFor(() => {
        expect(mockRemoveGuildMemberInfo).toHaveBeenCalledWith({
          guildId: GUILD,
          discordUserId: '987654321098765432',
        });
      });
    });

    it('runs a third report for the same key immediately once the chain has settled', async () => {
      const { update, remove } = register();
      const departed = member({ roles: [ADMIN] });
      update(member({ roles: [MEMBER] }), departed);
      remove(departed);

      await vi.waitFor(() => {
        expect(mockRemoveGuildMemberInfo).toHaveBeenCalledTimes(1);
      });
      // Let the settled chain's own `.finally()` cleanup run before checking
      // hygiene — a macrotask boundary drains every pending microtask.
      await new Promise(resolve => setTimeout(resolve, 0));

      update(member({ roles: [ADMIN] }), member({ roles: [MEMBER] }));
      expect(mockRecordGuildMemberInfo).toHaveBeenCalledTimes(2);
    });
  });
});
