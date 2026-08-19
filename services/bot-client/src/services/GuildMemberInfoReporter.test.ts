import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Events, type Client, type GuildMember } from 'discord.js';
import { registerGuildMemberInfoReporter } from './GuildMemberInfoReporter.js';

const mockRecordGuildMemberInfo = vi.hoisted(() => vi.fn());

vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({ recordGuildMemberInfo: mockRecordGuildMemberInfo }),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
}): GuildMember {
  return {
    id: '987654321098765432',
    partial: options.partial ?? false,
    guild: { id: GUILD },
    user: { bot: options.isBot ?? false },
    displayHexColor: options.color ?? '#000000',
    joinedAt: options.joinedAt ?? null,
    roles: { cache: new Map(options.roles.map(r => [r.id, r])) },
  } as unknown as GuildMember;
}

function fireUpdate(before: GuildMember, after: GuildMember): void {
  const handlers = new Map<string, (a: GuildMember, b: GuildMember) => void>();
  const client = {
    on: (event: string, handler: (a: GuildMember, b: GuildMember) => void) => {
      handlers.set(event, handler);
    },
  } as unknown as Client;

  registerGuildMemberInfoReporter(client);
  handlers.get(Events.GuildMemberUpdate)?.(before, after);
}

const ADMIN: FakeRole = { id: 'role-1', name: 'Admin', position: 5 };
const MEMBER: FakeRole = { id: 'role-2', name: 'Member', position: 1 };

describe('registerGuildMemberInfoReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordGuildMemberInfo.mockResolvedValue({ ok: true });
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
});
