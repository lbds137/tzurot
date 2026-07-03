import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRoutingContext, type RoutingContextDeps } from './RoutingContextResolver.js';
import type { RoutingContextRequest } from '@tzurot/common-types/schemas/api/internal';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { UserService } from './UserService.js';
import type { PersonaResolver } from './resolvers/PersonaResolver.js';

const REQUEST: RoutingContextRequest = {
  discordId: '278863839632818186',
  username: 'lila',
  displayName: 'Lila',
  personalityId: 'personality-uuid',
};

function buildDeps(overrides?: {
  getOrCreateUser?: ReturnType<typeof vi.fn>;
  getUserTimezone?: ReturnType<typeof vi.fn>;
  resolve?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
}): {
  deps: RoutingContextDeps;
  getOrCreateUser: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
} {
  const getOrCreateUser =
    overrides?.getOrCreateUser ??
    vi.fn().mockResolvedValue({ userId: 'user-uuid', defaultPersonaId: 'default-persona' });
  const getUserTimezone = overrides?.getUserTimezone ?? vi.fn().mockResolvedValue('UTC');
  const resolve =
    overrides?.resolve ??
    vi.fn().mockResolvedValue({
      config: { personaId: 'persona-uuid', preferredName: 'Nyx' },
      source: 'user-default',
    });
  const findUnique = overrides?.findUnique ?? vi.fn().mockResolvedValue(null);

  const userService = { getOrCreateUser, getUserTimezone } as unknown as UserService;
  const personaResolver = { resolve } as unknown as PersonaResolver;
  const prisma = {
    userPersonaHistoryConfig: { findUnique },
  } as unknown as PrismaClient;

  return { deps: { userService, personaResolver, prisma }, getOrCreateUser, resolve, findUnique };
}

describe('resolveRoutingContext', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('resolves the full routing bundle for a provisioned user', async () => {
    const { deps, resolve, findUnique } = buildDeps({
      findUnique: vi.fn().mockResolvedValue({ lastContextReset: new Date('2026-06-20T00:00:00Z') }),
    });

    const result = await resolveRoutingContext(deps, REQUEST);

    expect(result).toEqual({
      userId: 'user-uuid',
      personaId: 'persona-uuid',
      personaName: 'Nyx',
      timezone: 'UTC',
      contextEpoch: '2026-06-20T00:00:00.000Z',
    });
    // Cascade is keyed on the DISCORD id + personalityId, not the internal UUID.
    expect(resolve).toHaveBeenCalledWith('278863839632818186', 'personality-uuid');
    // Epoch lookup keys on the resolved internal UUID + persona, not the discord id.
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_personalityId_personaId: {
          userId: 'user-uuid',
          personalityId: 'personality-uuid',
          personaId: 'persona-uuid',
        },
      },
      select: { lastContextReset: true },
    });
  });

  it('returns null when the author is a bot (provisioning refuses)', async () => {
    const { deps, resolve } = buildDeps({ getOrCreateUser: vi.fn().mockResolvedValue(null) });

    const result = await resolveRoutingContext(deps, { ...REQUEST, isBot: true });

    expect(result).toBeNull();
    // Short-circuits before the cascade — no persona work for a rejected bot.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns null contextEpoch when no reset is recorded', async () => {
    const { deps } = buildDeps(); // findUnique defaults to null

    const result = await resolveRoutingContext(deps, REQUEST);

    expect(result?.contextEpoch).toBeNull();
  });

  it('short-circuits the epoch lookup for a system-default persona (empty personaId)', async () => {
    // personaId === '' is the system-default sentinel. persona_id is a @db.Uuid
    // column, so a findUnique keyed on '' throws `invalid input syntax for type
    // uuid` at runtime — it does NOT miss. The guard must skip the query so the
    // whole resolution doesn't blow up on every system-default-persona user.
    const findUnique = vi
      .fn()
      .mockRejectedValue(new Error('invalid input syntax for type uuid: ""'));
    const { deps } = buildDeps({
      resolve: vi.fn().mockResolvedValue({
        config: { personaId: '', preferredName: 'Default' },
        source: 'system-default',
      }),
      findUnique,
    });

    const result = await resolveRoutingContext(deps, REQUEST);

    expect(result).toEqual({
      userId: 'user-uuid',
      personaId: '',
      personaName: 'Default',
      timezone: 'UTC',
      contextEpoch: null,
    });
    // The guard short-circuits before the uuid-typed query ever runs — the
    // rejecting mock proves resolution survives what would be a Postgres throw.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('passes a null preferredName through as personaName', async () => {
    const { deps } = buildDeps({
      resolve: vi.fn().mockResolvedValue({
        config: { personaId: 'persona-uuid', preferredName: null },
        source: 'system-default',
      }),
    });

    const result = await resolveRoutingContext(deps, REQUEST);

    expect(result?.personaName).toBeNull();
  });

  it('forwards isBot=false default to provisioning', async () => {
    const { deps, getOrCreateUser } = buildDeps();

    await resolveRoutingContext(deps, REQUEST); // no isBot in REQUEST

    expect(getOrCreateUser).toHaveBeenCalledWith(
      '278863839632818186',
      'lila',
      'Lila',
      undefined,
      false
    );
  });
});
