/**
 * Unit tests for the exchange-memory rewrite: query scoping and every skip path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { REPLY_PAIRING_WINDOW_MS } from '@tzurot/common-types/constants/message';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const { mockWrite } = vi.hoisted(() => ({ mockWrite: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('./memorySingle.js', () => ({ writeMemoryContent: mockWrite }));

import { rewriteExchangeMemory } from './historyEditMemory.js';

const ROW = {
  id: 'row-1',
  channelId: '123456789012345678',
  personaId: 'persona-1',
  personalityId: 'personality-1',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
};

const TRIGGER = { role: 'user', discordMessageId: ['333333333333333333'] };

describe('rewriteExchangeMemory', () => {
  const triggerFindFirst = vi.fn();
  const memoryFindMany = vi.fn();

  const prisma = {
    conversationHistory: { findFirst: triggerFindFirst },
    memory: { findMany: memoryFindMany },
  } as unknown as PrismaClient;

  function memory(overrides: Record<string, unknown> = {}) {
    return {
      id: 'mem-1',
      content: '{user}: hi\n{assistant}: OLD',
      isLocked: false,
      chunkGroupId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    triggerFindFirst.mockResolvedValue(TRIGGER);
    memoryFindMany.mockResolvedValue([memory()]);
    mockWrite.mockResolvedValue({});
  });

  it('scopes the trigger lookup by persona, personality and the pairing window', async () => {
    await rewriteExchangeMemory(prisma, ROW, 'NEW');

    expect(triggerFindFirst).toHaveBeenCalledWith({
      where: {
        channelId: ROW.channelId,
        personalityId: ROW.personalityId,
        personaId: ROW.personaId,
        createdAt: {
          lt: ROW.createdAt,
          gte: new Date(ROW.createdAt.getTime() - REPLY_PAIRING_WINDOW_MS),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { role: true, discordMessageId: true },
    });
  });

  it('scopes the memory lookup by personality AND persona', async () => {
    await rewriteExchangeMemory(prisma, ROW, 'NEW');

    expect(memoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageIds: { hasSome: TRIGGER.discordMessageId },
          personalityId: ROW.personalityId,
          personaId: ROW.personaId,
          visibility: 'normal',
        },
        take: 2,
      })
    );
  });

  it('returns false without a memory lookup when the preceding row is not a user turn', async () => {
    triggerFindFirst.mockResolvedValue({ role: 'assistant', discordMessageId: ['1'] });

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(memoryFindMany).not.toHaveBeenCalled();
  });

  it('returns false when the trigger has no discord ids', async () => {
    triggerFindFirst.mockResolvedValue({ role: 'user', discordMessageId: [] });

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(memoryFindMany).not.toHaveBeenCalled();
  });

  it('returns false with no write when no memory matches', async () => {
    memoryFindMany.mockResolvedValue([]);

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false with no write when two memories match (ambiguous)', async () => {
    memoryFindMany.mockResolvedValue([memory(), memory({ id: 'mem-2' })]);

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false with no write for a locked memory', async () => {
    memoryFindMany.mockResolvedValue([memory({ isLocked: true })]);

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false with no write for a chunked memory', async () => {
    memoryFindMany.mockResolvedValue([memory({ chunkGroupId: 'group-1' })]);

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false with no write for content that does not match the template', async () => {
    memoryFindMany.mockResolvedValue([memory({ content: 'free-form text' })]);

    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns false with no write when the new reply would make the memory unparseable', async () => {
    expect(await rewriteExchangeMemory(prisma, ROW, 'a\n{assistant}: b')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('rewrites only the assistant half on the happy path', async () => {
    expect(await rewriteExchangeMemory(prisma, ROW, 'NEW')).toBe(true);

    expect(mockWrite).toHaveBeenCalledWith(prisma, 'mem-1', '{user}: hi\n{assistant}: NEW');
  });

  it('preserves a referenced block in the user part', async () => {
    const content = '{user}: hi\n\n[Referenced content: quoted]\n{assistant}: OLD';
    memoryFindMany.mockResolvedValue([memory({ content })]);

    await rewriteExchangeMemory(prisma, ROW, 'NEW');

    expect(mockWrite).toHaveBeenCalledWith(
      prisma,
      'mem-1',
      '{user}: hi\n\n[Referenced content: quoted]\n{assistant}: NEW'
    );
  });

  it('preserves a trailing referenced block on the assistant tail', async () => {
    const content = '{user}: hi\n{assistant}: OLD\n\n[Referenced content: quoted]';
    memoryFindMany.mockResolvedValue([memory({ content })]);

    await rewriteExchangeMemory(prisma, ROW, 'NEW');

    expect(mockWrite).toHaveBeenCalledWith(
      prisma,
      'mem-1',
      '{user}: hi\n{assistant}: NEW\n\n[Referenced content: quoted]'
    );
  });
});
