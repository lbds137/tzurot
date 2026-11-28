import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageRole, REPLY_PAIRING_WINDOW_MS } from '@tzurot/common-types/constants/message';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { findImmediateTriggerRow, triggerMemoryExists } from './legacyIncognitoEvidence.js';

function makePrisma(overrides: {
  trigger?: { role?: string; discordMessageId: string[]; deletedAt?: Date | null } | null;
  memory?: { id: string } | null;
}) {
  const resolvedTrigger =
    overrides.trigger === undefined || overrides.trigger === null
      ? null
      : { role: MessageRole.User, ...overrides.trigger };
  const findTrigger = vi.fn().mockResolvedValue(resolvedTrigger);
  const findMemory = vi.fn().mockResolvedValue(overrides.memory ?? null);
  const prisma = {
    conversationHistory: { findFirst: findTrigger },
    memory: { findFirst: findMemory },
  } as unknown as Pick<PrismaClient, 'conversationHistory' | 'memory'>;
  return { prisma, findTrigger, findMemory };
}

describe('triggerMemoryExists', () => {
  const replyRow = {
    channelId: 'chan-100',
    personalityId: 'pers-200',
    createdAt: new Date('2026-05-10T12:00:00.001Z'),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('no trigger → false, asserting trigger query where args and skipping memory query', async () => {
    const { prisma, findTrigger, findMemory } = makePrisma({ trigger: null });

    const result = await triggerMemoryExists(prisma, replyRow);

    expect(result).toBe(false);
    expect(findTrigger).toHaveBeenCalledWith({
      where: {
        channelId: 'chan-100',
        personalityId: 'pers-200',
        createdAt: {
          lt: replyRow.createdAt,
          gte: new Date(replyRow.createdAt.getTime() - REPLY_PAIRING_WINDOW_MS),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { role: true, discordMessageId: true },
    });
    expect(findMemory).not.toHaveBeenCalled();
  });

  it('soft-deleted trigger row is still chosen (where has no deletedAt key)', async () => {
    const softDeletedTrigger = {
      role: MessageRole.User,
      discordMessageId: ['333333333333333333'],
      deletedAt: new Date('2026-05-10T11:59:00.000Z'),
    };
    const { prisma, findTrigger, findMemory } = makePrisma({
      memory: { id: 'mem-from-deleted-trigger' },
    });
    findTrigger.mockImplementation(async ({ where }: { where: { deletedAt?: null } }) =>
      where.deletedAt === null ? null : softDeletedTrigger
    );

    const result = await triggerMemoryExists(prisma, replyRow);

    expect(result).toBe(true);
    const triggerQuery = findTrigger.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(triggerQuery.where).not.toHaveProperty('deletedAt');
    expect(findMemory).toHaveBeenCalledWith({
      where: {
        messageIds: { hasSome: ['333333333333333333'] },
        personalityId: 'pers-200',
        visibility: 'normal',
      },
      select: { id: true },
    });
  });

  it('immediately preceding row in the pairing window is an assistant row → false, and the memory query is not called', async () => {
    const candidateRows = [
      { role: MessageRole.Assistant, discordMessageId: ['222222222222222222'] },
      { role: MessageRole.User, discordMessageId: ['111111111111111111'] },
    ];
    const { prisma, findTrigger, findMemory } = makePrisma({
      memory: { id: 'mem-earlier-user' },
    });
    findTrigger.mockImplementation(
      async ({ where }: { where: { role?: string } }) =>
        candidateRows.find(r => where.role === undefined || r.role === where.role) ?? null
    );

    const result = await triggerMemoryExists(prisma, replyRow);

    expect(result).toBe(false);
    expect(findTrigger).toHaveBeenCalledWith({
      where: {
        channelId: 'chan-100',
        personalityId: 'pers-200',
        createdAt: {
          lt: replyRow.createdAt,
          gte: new Date(replyRow.createdAt.getTime() - REPLY_PAIRING_WINDOW_MS),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { role: true, discordMessageId: true },
    });
    expect(findMemory).not.toHaveBeenCalled();
  });

  it('trigger without ids → false and skips memory query', async () => {
    const { prisma, findTrigger, findMemory } = makePrisma({
      trigger: { discordMessageId: [] },
    });

    const result = await triggerMemoryExists(prisma, replyRow);

    expect(result).toBe(false);
    expect(findTrigger).toHaveBeenCalledTimes(1);
    expect(findMemory).not.toHaveBeenCalled();
  });

  it('memory found → true, asserting memory query where args across the seam', async () => {
    const { prisma, findMemory } = makePrisma({
      trigger: { discordMessageId: ['111111111111111111', '222222222222222222'] },
      memory: { id: 'mem-uuid-1' },
    });

    const result = await triggerMemoryExists(prisma, replyRow);

    expect(result).toBe(true);
    expect(findMemory).toHaveBeenCalledWith({
      where: {
        messageIds: { hasSome: ['111111111111111111', '222222222222222222'] },
        personalityId: 'pers-200',
        visibility: 'normal',
      },
      select: { id: true },
    });
  });

  it('memory absent → false', async () => {
    const { prisma, findMemory } = makePrisma({
      trigger: { discordMessageId: ['111111111111111111'] },
      memory: null,
    });

    const result = await triggerMemoryExists(prisma, replyRow);

    expect(result).toBe(false);
    expect(findMemory).toHaveBeenCalledWith({
      where: {
        messageIds: { hasSome: ['111111111111111111'] },
        personalityId: 'pers-200',
        visibility: 'normal',
      },
      select: { id: true },
    });
  });
});

describe('findImmediateTriggerRow', () => {
  const createdAt = new Date('2026-05-10T12:00:00.001Z');
  const base = { channelId: 'chan-100', personalityId: 'pers-200', createdAt };

  it('adds the personaId filter when given and omits it when not', async () => {
    const { prisma, findTrigger } = makePrisma({ trigger: { discordMessageId: ['1'] } });

    const withPersona = await findImmediateTriggerRow(prisma, { ...base, personaId: 'persona-9' });
    await findImmediateTriggerRow(prisma, base);

    expect(withPersona).toEqual({ discordMessageId: ['1'] });
    expect(findTrigger.mock.calls[0][0].where).toMatchObject({ personaId: 'persona-9' });
    expect(findTrigger.mock.calls[1][0].where).not.toHaveProperty('personaId');
  });

  it('returns null for a non-user row or one without a Discord message id', async () => {
    const assistant = makePrisma({
      trigger: { role: MessageRole.Assistant, discordMessageId: ['1'] },
    });
    const noId = makePrisma({ trigger: { discordMessageId: [] } });

    expect(await findImmediateTriggerRow(assistant.prisma, base)).toBeNull();
    expect(await findImmediateTriggerRow(noId.prisma, base)).toBeNull();
  });
});
