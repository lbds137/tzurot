import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    getPrismaClient: () => ({ user: { findUnique: mockFindUnique } }),
  };
});

import {
  createDiagnosticCollectorForRequest,
  resolvePersonalityOwnerDiscordId,
} from './personalityOwnerResolver.js';

describe('resolvePersonalityOwnerDiscordId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the discordId when the User row exists', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '111111111111111111' });
    const result = await resolvePersonalityOwnerDiscordId('owner-uuid');
    expect(result).toBe('111111111111111111');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'owner-uuid' },
      select: { discordId: true },
    });
  });

  it('returns null when the User row was deleted (findUnique returns null)', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await resolvePersonalityOwnerDiscordId('owner-uuid');
    expect(result).toBeNull();
  });

  it('returns null and does not throw when prisma throws (transient DB error)', async () => {
    mockFindUnique.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await resolvePersonalityOwnerDiscordId('owner-uuid');
    expect(result).toBeNull();
  });

  it('returns null when the User row exists but discordId is missing', async () => {
    // Defensive: shouldn't happen per schema (discordId is required), but
    // guards against a future schema that drops the column.
    mockFindUnique.mockResolvedValue({});
    const result = await resolvePersonalityOwnerDiscordId('owner-uuid');
    expect(result).toBeNull();
  });
});

describe('createDiagnosticCollectorForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads the resolved Discord ID into the collector meta', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '111111111111111111' });
    const collector = await createDiagnosticCollectorForRequest({
      requestId: 'r1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
    });
    const payload = collector.finalize();
    expect(payload.meta.personalityOwnerDiscordId).toBe('111111111111111111');
    expect(payload.meta.personalityName).toBe('TestPersonality');
  });

  it('produces undefined personalityOwnerDiscordId in meta when owner resolution fails', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));
    const collector = await createDiagnosticCollectorForRequest({
      requestId: 'r1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
    });
    const payload = collector.finalize();
    expect(payload.meta.personalityOwnerDiscordId).toBeUndefined();
  });

  it('passes through optional fields (triggerMessageId, serverId, channelId)', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '999' });
    const collector = await createDiagnosticCollectorForRequest({
      requestId: 'r1',
      triggerMessageId: 'msg-1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
      serverId: 'guild-1',
      channelId: 'channel-1',
    });
    const payload = collector.finalize();
    expect(payload.meta.triggerMessageId).toBe('msg-1');
    expect(payload.meta.guildId).toBe('guild-1');
    expect(payload.meta.channelId).toBe('channel-1');
  });

  it('coerces undefined serverId to null in meta (DM convention)', async () => {
    mockFindUnique.mockResolvedValue({ discordId: '999' });
    const collector = await createDiagnosticCollectorForRequest({
      requestId: 'r1',
      personalityId: 'p1',
      personalityName: 'TestPersonality',
      personalityOwnerInternalId: 'owner-uuid',
      userId: 'user-discord-id',
      // No serverId — DM context
    });
    const payload = collector.finalize();
    expect(payload.meta.guildId).toBeNull();
  });
});
