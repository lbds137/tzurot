/**
 * Component test: editing an assistant reply over REAL PGLite.
 *
 * Pins the access gate (a mocked prisma can only show that SOME filter was
 * passed) and the memory rewrite's scoping, including the shared-trigger case
 * where one user message produced replies from two personalities.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import type { AuthenticatedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const OWNER_USER = '8d4f2a88-0000-4000-8000-00000000f001';
const OWNER_PERSONA = '8d4f2a88-0000-4000-8000-00000000f002';
const PERSONALITY_A = '8d4f2a88-0000-4000-8000-00000000f003';
const PERSONALITY_B = '8d4f2a88-0000-4000-8000-00000000f004';
const SYSTEM_PROMPT = '8d4f2a88-0000-4000-8000-00000000f005';
const OTHER_USER = '8d4f2a88-0000-4000-8000-00000000f006';
const OTHER_PERSONA = '8d4f2a88-0000-4000-8000-00000000f007';

const OWNER_DISCORD = '900000000000000081';
const OTHER_DISCORD = '900000000000000082';

const CHANNEL = '123456789012345678';
const TRIGGER_DISCORD_ID = '333333333333333333';
const REPLY_A_DISCORD_ID = '444444444444444441';
const REPLY_B_DISCORD_ID = '444444444444444442';

const TRIGGER_ROW = '8d4f2a88-0000-4000-8000-00000000f101';
const REPLY_A_ROW = '8d4f2a88-0000-4000-8000-00000000f102';
const REPLY_B_ROW = '8d4f2a88-0000-4000-8000-00000000f103';
const MEMORY_A = '8d4f2a88-0000-4000-8000-00000000f201';
const MEMORY_B = '8d4f2a88-0000-4000-8000-00000000f202';

const TRIGGER_TIME = new Date('2026-06-04T12:00:00.000Z');
const REPLY_A_TIME = new Date('2026-06-04T12:00:05.000Z');
const REPLY_B_TIME = new Date('2026-06-04T12:00:06.000Z');

const { mockIsBotOwner } = vi.hoisted(() => ({ mockIsBotOwner: vi.fn(() => false) }));

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return { ...actual, isBotOwner: mockIsBotOwner };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import { handleEditAssistantMessage } from './historyEdit.js';

describe('edit assistant reply (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: OWNER_USER,
      personaId: OWNER_PERSONA,
      discordId: OWNER_DISCORD,
      username: 'edituser',
      personaName: 'Edit Persona',
      personaPreferredName: 'Editor',
      personaContent: 'The editing persona',
    });
    await seedUserWithPersona(prisma, {
      userId: OTHER_USER,
      personaId: OTHER_PERSONA,
      discordId: OTHER_DISCORD,
      username: 'otheredit',
      personaName: 'Other Persona',
      personaPreferredName: 'Otherer',
      personaContent: 'A different persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'E Prompt', 'You are an edit bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_A}::uuid, 'EBotA', 'E Bot A', 'ebot-a', ${SYSTEM_PROMPT}::uuid, 'A character', 'Thoughtful', ${OWNER_USER}::uuid, NOW()),
             (${PERSONALITY_B}::uuid, 'EBotB', 'E Bot B', 'ebot-b', ${SYSTEM_PROMPT}::uuid, 'B character', 'Quiet', ${OWNER_USER}::uuid, NOW())
    `;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM memories`;
    await prisma.$executeRaw`DELETE FROM conversation_history`;
    mockIsBotOwner.mockReturnValue(false);

    // One user message answered by two personalities (a shared trigger).
    await prisma.conversationHistory.createMany({
      data: [
        {
          id: TRIGGER_ROW,
          channelId: CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'user',
          content: 'hi',
          discordMessageId: [TRIGGER_DISCORD_ID],
          createdAt: TRIGGER_TIME,
        },
        {
          id: REPLY_A_ROW,
          channelId: CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'OLD-A',
          discordMessageId: [REPLY_A_DISCORD_ID],
          createdAt: REPLY_A_TIME,
        },
        {
          id: REPLY_B_ROW,
          channelId: CHANNEL,
          personalityId: PERSONALITY_B,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'OLD-B',
          discordMessageId: [REPLY_B_DISCORD_ID],
          createdAt: REPLY_B_TIME,
        },
      ],
    });
    // Personality B's own trigger row (same Discord message, separate history).
    await prisma.conversationHistory.create({
      data: {
        id: '8d4f2a88-0000-4000-8000-00000000f104',
        channelId: CHANNEL,
        personalityId: PERSONALITY_B,
        personaId: OWNER_PERSONA,
        role: 'user',
        content: 'hi',
        discordMessageId: [TRIGGER_DISCORD_ID],
        createdAt: new Date('2026-06-04T12:00:00.500Z'),
      },
    });
    await prisma.memory.createMany({
      data: [
        {
          id: MEMORY_A,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: OLD-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['edituser'],
        },
        {
          id: MEMORY_B,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_B,
          content: '{user}: hi\n{assistant}: OLD-B',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['edituser'],
        },
      ],
    });
  });

  function deps(): RouteDeps {
    return { prisma } as unknown as RouteDeps;
  }

  async function patch(userId: string, messageId: string, body: Record<string, unknown>) {
    const req = {
      userId,
      params: { messageId },
      body,
      query: {},
    } as unknown as AuthenticatedRequest;
    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    await handleEditAssistantMessage(deps())(
      req,
      { status, json } as unknown as Response,
      () => undefined
    );
    return { json, status };
  }

  async function content(table: 'conversation_history' | 'memories', id: string) {
    const rows =
      table === 'memories'
        ? await prisma.$queryRaw<
            { content: string }[]
          >`SELECT content FROM memories WHERE id = ${id}::uuid`
        : await prisma.$queryRaw<
            { content: string }[]
          >`SELECT content FROM conversation_history WHERE id = ${id}::uuid`;
    return rows[0].content;
  }

  it('404s a non-owner and leaves the row unchanged', async () => {
    const { status } = await patch(OTHER_DISCORD, REPLY_A_DISCORD_ID, {
      content: 'HACKED',
      discordMessageIds: [REPLY_A_DISCORD_ID],
    });

    expect(status).toHaveBeenCalledWith(404);
    expect(await content('conversation_history', REPLY_A_ROW)).toBe('OLD-A');
    expect(await content('memories', MEMORY_A)).toBe('{user}: hi\n{assistant}: OLD-A');
  });

  it('updates the row for the persona owner', async () => {
    const { json } = await patch(OWNER_DISCORD, REPLY_A_DISCORD_ID, {
      content: 'NEW-A',
      discordMessageIds: [REPLY_A_DISCORD_ID, '444444444444444449'],
    });

    expect(json).toHaveBeenCalledWith({ edited: true, memoryUpdated: true });
    const rows = await prisma.conversationHistory.findMany({
      where: { id: REPLY_A_ROW },
      select: { content: true, discordMessageId: true, editedAt: true },
      take: 1,
    });
    expect(rows[0].content).toBe('NEW-A');
    expect(rows[0].discordMessageId).toEqual([REPLY_A_DISCORD_ID, '444444444444444449']);
    expect(rows[0].editedAt).not.toBeNull();
  });

  it('rewrites only the edited personality memory when two share a trigger', async () => {
    await patch(OWNER_DISCORD, REPLY_A_DISCORD_ID, {
      content: 'NEW-A',
      discordMessageIds: [REPLY_A_DISCORD_ID],
    });

    expect(await content('memories', MEMORY_A)).toBe('{user}: hi\n{assistant}: NEW-A');
    expect(await content('memories', MEMORY_B)).toBe('{user}: hi\n{assistant}: OLD-B');
  });
});
