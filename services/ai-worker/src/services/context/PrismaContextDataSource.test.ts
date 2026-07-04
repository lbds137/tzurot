import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetChannelHistory = vi.hoisted(() => vi.fn());
const mockGetCrossChannelHistory = vi.hoisted(() => vi.fn());
const mockGetMessageByDiscordId = vi.hoisted(() => vi.fn());
const mockGetUserTimezone = vi.hoisted(() => vi.fn());

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('@tzurot/conversation-history', () => ({
  ConversationHistoryService: class {
    getChannelHistory = mockGetChannelHistory;
    getCrossChannelHistory = mockGetCrossChannelHistory;
    getMessageByDiscordId = mockGetMessageByDiscordId;
  },
}));

vi.mock('@tzurot/identity', () => ({
  UserService: class {
    getUserTimezone = mockGetUserTimezone;
  },
}));

import { PrismaContextDataSource } from './PrismaContextDataSource.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

const mockFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockPersonalityFindMany = vi.fn();
const mockConversationHistoryFindMany = vi.fn();
const fakePrisma = {
  userPersonaHistoryConfig: { findUnique: mockFindUnique },
  user: { findUnique: mockUserFindUnique },
  personality: { findMany: mockPersonalityFindMany },
  conversationHistory: { findMany: mockConversationHistoryFindMany },
} as unknown as PrismaClient;

describe('PrismaContextDataSource', () => {
  let source: PrismaContextDataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    source = new PrismaContextDataSource(fakePrisma);
  });

  it('delegates getChannelHistory with identical argument order', async () => {
    const epoch = new Date('2026-01-01T00:00:00Z');
    mockGetChannelHistory.mockResolvedValue([{ id: 'm1' }]);

    const result = await source.getChannelHistory('chan-1', 25, epoch, 3600);

    expect(mockGetChannelHistory).toHaveBeenCalledWith('chan-1', 25, epoch, 3600);
    expect(result).toEqual([{ id: 'm1' }]);
  });

  it('maps cross-channel params onto the positional service signature', async () => {
    const epoch = new Date('2026-01-01T00:00:00Z');
    mockGetCrossChannelHistory.mockResolvedValue([]);

    await source.getCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'pers-1',
      excludeChannelId: 'chan-1',
      limit: 25,
      maxAgeSeconds: 3600,
      contextEpoch: epoch,
    });

    expect(mockGetCrossChannelHistory).toHaveBeenCalledWith('persona-1', 'pers-1', 'chan-1', 25, {
      maxAgeSeconds: 3600,
      contextEpoch: epoch,
    });
  });

  it('normalizes null maxAgeSeconds to undefined for the time filter', async () => {
    mockGetCrossChannelHistory.mockResolvedValue([]);

    await source.getCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'pers-1',
      excludeChannelId: 'chan-1',
      limit: 25,
      maxAgeSeconds: null,
    });

    expect(mockGetCrossChannelHistory).toHaveBeenCalledWith('persona-1', 'pers-1', 'chan-1', 25, {
      maxAgeSeconds: undefined,
      contextEpoch: undefined,
    });
  });

  it('delegates getMessageByDiscordId for the transcript DB tier', async () => {
    mockGetMessageByDiscordId.mockResolvedValue({ id: 'm1', content: 'a transcript' });

    const result = await source.getMessageByDiscordId('discord-1');

    expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('discord-1');
    expect(result).toEqual({ id: 'm1', content: 'a transcript' });
  });

  it('looks up users by Discord id for the mention DB fallback', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'internal-1', username: 'someone' });

    const result = await source.findUserByDiscordId('discord-9');

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { discordId: 'discord-9' },
      select: { id: true, username: true },
    });
    expect(result).toEqual({ id: 'internal-1', username: 'someone' });
  });

  it('delegates getUserTimezone', async () => {
    mockGetUserTimezone.mockResolvedValue('America/New_York');

    await expect(source.getUserTimezone('internal-1')).resolves.toBe('America/New_York');
    expect(mockGetUserTimezone).toHaveBeenCalledWith('internal-1');
  });

  it('reads the context epoch via the composite-key lookup', async () => {
    const reset = new Date('2026-05-01T00:00:00Z');
    mockFindUnique.mockResolvedValue({ lastContextReset: reset });

    const epoch = await source.getContextEpoch('internal-1', 'pers-1', 'persona-1');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        userId_personalityId_personaId: {
          userId: 'internal-1',
          personalityId: 'pers-1',
          personaId: 'persona-1',
        },
      },
      select: { lastContextReset: true },
    });
    expect(epoch).toEqual(reset);
  });

  it('returns undefined when no history config row exists', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(
      source.getContextEpoch('internal-1', 'pers-1', 'persona-1')
    ).resolves.toBeUndefined();
  });

  it('returns undefined when lastContextReset is null', async () => {
    mockFindUnique.mockResolvedValue({ lastContextReset: null });

    await expect(
      source.getContextEpoch('internal-1', 'pers-1', 'persona-1')
    ).resolves.toBeUndefined();
  });

  describe('getPersonalityNamesByIds', () => {
    it('returns a id→name map for the queried ids', async () => {
      mockPersonalityFindMany.mockResolvedValue([
        { id: 'pers-1', name: 'Emily' },
        { id: 'pers-2', name: 'Fallen Emily' },
      ]);

      const result = await source.getPersonalityNamesByIds(['pers-1', 'pers-2']);

      expect(mockPersonalityFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['pers-1', 'pers-2'] } },
        select: { id: true, name: true },
        take: 2,
      });
      expect(result).toEqual(
        new Map([
          ['pers-1', 'Emily'],
          ['pers-2', 'Fallen Emily'],
        ])
      );
    });

    it('short-circuits to an empty map without querying when given no ids', async () => {
      const result = await source.getPersonalityNamesByIds([]);

      expect(result.size).toBe(0);
      expect(mockPersonalityFindMany).not.toHaveBeenCalled();
    });
  });

  describe('getUserIdentitiesByDiscordIds', () => {
    it('maps persisted user rows to identities keyed by discord message id', async () => {
      mockConversationHistoryFindMany.mockResolvedValue([
        {
          discordMessageId: ['d-relay-1'],
          personaId: 'persona-uuid',
          persona: { name: 'lila', preferredName: 'Lila', owner: { username: 'lbds137' } },
        },
      ]);

      const result = await source.getUserIdentitiesByDiscordIds(['d-relay-1', 'd-relay-2']);

      // Assert the contract (bounded query + user-scoped, id-matched) without
      // over-coupling to the exact select shape.
      expect(mockConversationHistoryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            discordMessageId: { hasSome: ['d-relay-1', 'd-relay-2'] },
            role: MessageRole.User,
          },
          take: 2,
        })
      );
      expect(result).toEqual(
        new Map([
          [
            'd-relay-1',
            { personaId: 'persona-uuid', personaName: 'Lila', discordUsername: 'lbds137' },
          ],
        ])
      );
    });

    it('falls back to persona.name when preferredName is null', async () => {
      mockConversationHistoryFindMany.mockResolvedValue([
        {
          discordMessageId: ['d-x'],
          personaId: 'p2',
          persona: { name: 'canonical', preferredName: null, owner: { username: 'u' } },
        },
      ]);

      const result = await source.getUserIdentitiesByDiscordIds(['d-x']);

      expect(result.get('d-x')?.personaName).toBe('canonical');
    });

    it('short-circuits to an empty map without querying when given no ids', async () => {
      const result = await source.getUserIdentitiesByDiscordIds([]);

      expect(result.size).toBe(0);
      expect(mockConversationHistoryFindMany).not.toHaveBeenCalled();
    });
  });
});
