/**
 * Component test: rerolling an assistant reply over REAL PGLite.
 *
 * Pins the access gate, the latest-only rule, the memory plan's scoping (two
 * personalities sharing one trigger), the commit transaction and the abort's
 * id arithmetic against real rows; a mocked prisma can only show that SOME
 * filter was passed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateRerolledConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import type { AuthenticatedRequest } from '../../types.js';
import { asRouteHandler, stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../routeDeps.js';
import { handleLookupPersonalityFromMessage } from './conversationLookup.js';

const OWNER_USER = '7c1e9b55-0000-4000-8000-00000000a001';
const OWNER_PERSONA = '7c1e9b55-0000-4000-8000-00000000a002';
const PERSONALITY_A = '7c1e9b55-0000-4000-8000-00000000a003';
const PERSONALITY_B = '7c1e9b55-0000-4000-8000-00000000a004';
const SYSTEM_PROMPT = '7c1e9b55-0000-4000-8000-00000000a005';
const OTHER_USER = '7c1e9b55-0000-4000-8000-00000000a006';
const OTHER_PERSONA = '7c1e9b55-0000-4000-8000-00000000a007';

const OWNER_DISCORD = '900000000000000091';
const OTHER_DISCORD = '900000000000000092';

const CHANNEL = '123456789012345679';
const TRIGGER_DISCORD_ID = '333333333333333301';
const REPLY_A_DISCORD_ID = '444444444444444401';
const REPLY_B_DISCORD_ID = '444444444444444402';

const TRIGGER_ROW = '7c1e9b55-0000-4000-8000-00000000a101';
const REPLY_A_ROW = '7c1e9b55-0000-4000-8000-00000000a102';
const REPLY_B_ROW = '7c1e9b55-0000-4000-8000-00000000a103';
const TRIGGER_B_ROW = '7c1e9b55-0000-4000-8000-00000000a104';
const MEMORY_A = '7c1e9b55-0000-4000-8000-00000000a201';
const MEMORY_B = '7c1e9b55-0000-4000-8000-00000000a202';
const NEW_MEMORY = '7c1e9b55-0000-4000-8000-00000000a203';
const NEW_PENDING = '7c1e9b55-0000-4000-8000-00000000a301';

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

import {
  handleAbortRerollAssistantMessage,
  handleCheckRerollAssistantMessage,
  handleRerollAssistantMessage,
} from './historyReroll.js';

type Handler = typeof handleCheckRerollAssistantMessage;

describe('reroll assistant reply (component, PGLite)', () => {
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
      username: 'rerolluser',
      personaName: 'Reroll Persona',
      personaPreferredName: 'Roller',
      personaContent: 'The rerolling persona',
    });
    await seedUserWithPersona(prisma, {
      userId: OTHER_USER,
      personaId: OTHER_PERSONA,
      discordId: OTHER_DISCORD,
      username: 'otherroll',
      personaName: 'Other Persona',
      personaPreferredName: 'Otherer',
      personaContent: 'A different persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'R Prompt', 'You are a reroll bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_A}::uuid, 'RBotA', 'R Bot A', 'rbot-a', ${SYSTEM_PROMPT}::uuid, 'A character', 'Thoughtful', ${OWNER_USER}::uuid, NOW()),
             (${PERSONALITY_B}::uuid, 'RBotB', 'R Bot B', 'rbot-b', ${SYSTEM_PROMPT}::uuid, 'B character', 'Quiet', ${OWNER_USER}::uuid, NOW())
    `;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM job_results`;
    await prisma.$executeRaw`DELETE FROM pending_memories`;
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
          id: TRIGGER_B_ROW,
          channelId: CHANNEL,
          personalityId: PERSONALITY_B,
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
    await prisma.memory.createMany({
      data: [
        {
          id: MEMORY_A,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: OLD-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
        {
          id: MEMORY_B,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_B,
          content: '{user}: hi\n{assistant}: OLD-B',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      ],
    });
  });

  function deps(): RouteDeps {
    return { prisma } as unknown as RouteDeps;
  }

  async function call(
    handler: Handler,
    userId: string,
    messageId: string,
    body: Record<string, unknown>
  ) {
    const req = {
      userId,
      params: { messageId },
      body,
      query: {},
    } as unknown as AuthenticatedRequest;
    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    await handler(deps())(req, { status, json } as unknown as Response, () => undefined);
    return { json, status };
  }

  const check = (userId: string, messageId: string, body: Record<string, unknown> = {}) =>
    call(handleCheckRerollAssistantMessage, userId, messageId, body);
  const commit = (body: Record<string, unknown>, messageId = REPLY_A_DISCORD_ID) =>
    call(handleRerollAssistantMessage, OWNER_DISCORD, messageId, body);
  const abort = (body: Record<string, unknown>) =>
    call(handleAbortRerollAssistantMessage, OWNER_DISCORD, REPLY_A_DISCORD_ID, body);

  function commitBody(overrides: Record<string, unknown> = {}) {
    return {
      rowId: REPLY_A_ROW,
      attemptId: 'attempt-1',
      jobId: 'job-1',
      content: 'NEW-A',
      discordMessageIds: [REPLY_A_DISCORD_ID],
      newMemoryIds: [] as string[],
      newPendingIds: [] as string[],
      ...overrides,
    };
  }

  /** The memory row's visibility, or undefined when it does not exist. */
  async function visibility(id: string) {
    const rows = await prisma.memory.findMany({
      where: { id },
      select: { visibility: true },
      take: 1,
    });
    return rows.at(0)?.visibility;
  }

  async function snapshot() {
    const history = await prisma.conversationHistory.findMany({
      select: { id: true, content: true, deletedAt: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    const memories = await prisma.memory.findMany({
      select: { id: true, content: true, visibility: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    const pendings = await prisma.pendingMemory.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    return { history, memories, pendings };
  }

  describe('reroll-check', () => {
    it('returns the row, trigger and memory plan for the persona owner', async () => {
      const { json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

      expect(json).toHaveBeenCalledWith({
        rowId: REPLY_A_ROW,
        personalityId: PERSONALITY_A,
        personaId: OWNER_PERSONA,
        ownerDiscordId: OWNER_DISCORD,
        incognito: false,
        content: 'OLD-A',
        discordMessageIds: [REPLY_A_DISCORD_ID],
        trigger: {
          discordMessageId: TRIGGER_DISCORD_ID,
          content: 'hi',
          createdAt: TRIGGER_TIME.toISOString(),
        },
        memoryPlan: { kind: 'remove', memoryIds: [MEMORY_A], pendingIds: [] },
      });
    });

    it('404s a non-owner', async () => {
      const { status } = await check(OTHER_DISCORD, REPLY_A_DISCORD_ID);

      expect(status).toHaveBeenCalledWith(404);
    });

    it('allows the bot owner on a row of another persona', async () => {
      mockIsBotOwner.mockReturnValue(true);

      const { json, status } = await check(OTHER_DISCORD, REPLY_A_DISCORD_ID);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ rowId: REPLY_A_ROW }));
    });

    it('refuses a reply that is not the latest in its channel (latest-only)', async () => {
      await prisma.conversationHistory.create({
        data: {
          id: '7c1e9b55-0000-4000-8000-00000000a105',
          channelId: CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'NEWER-A',
          discordMessageId: ['444444444444444499'],
          createdAt: new Date('2026-06-04T12:05:00.000Z'),
        },
      });

      const { status, json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_LATEST' }));
    });

    it('mutates nothing (preflight is read-only)', async () => {
      const before = await snapshot();

      await check(OWNER_DISCORD, REPLY_A_DISCORD_ID, {
        excludeMemoryIds: [NEW_MEMORY],
        excludePendingIds: [NEW_PENDING],
      });

      expect(await snapshot()).toEqual(before);
    });

    it('blocks (locked) when the primary memory is locked', async () => {
      await prisma.memory.update({ where: { id: MEMORY_A }, data: { isLocked: true } });

      const { json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ memoryPlan: { kind: 'blocked', reason: 'locked' } })
      );
    });

    it('blocks when a sibling memory of the coalesced reply is locked', async () => {
      await prisma.conversationHistory.create({
        data: {
          id: '7c1e9b55-0000-4000-8000-00000000a106',
          channelId: CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OTHER_PERSONA,
          role: 'user',
          content: 'yo',
          discordMessageId: ['666666666666666601'],
          createdAt: new Date('2026-06-04T12:00:03.000Z'),
        },
      });
      await prisma.memory.create({
        data: {
          id: '7c1e9b55-0000-4000-8000-00000000a204',
          personaId: OTHER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: yo\n{assistant}: OLD-A',
          messageIds: ['666666666666666601'],
          senders: ['otherroll'],
          isLocked: true,
        },
      });

      const { json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ memoryPlan: { kind: 'blocked', reason: 'other-locked' } })
      );
    });

    it('does not mistake the new reply memory for the old one, excluded by id or young by age', async () => {
      await prisma.memory.create({
        data: {
          id: NEW_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: NEW-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      });

      const young = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);
      const excluded = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID, {
        excludeMemoryIds: [NEW_MEMORY],
      });

      // A young memory with another reply text may belong to a reroll in flight:
      // it is neither the old reply's memory nor an ambiguity.
      expect(young.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryPlan: { kind: 'remove', memoryIds: [MEMORY_A], pendingIds: [] },
        })
      );
      expect(excluded.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryPlan: { kind: 'remove', memoryIds: [MEMORY_A], pendingIds: [] },
        })
      );
    });

    it('finds and plans the removal of an untriggered weigh-in memory', async () => {
      const weighInChannel = '123456789012345680';
      const replyRow = '7c1e9b55-0000-4000-8000-00000000a107';
      const weighInMemory = '7c1e9b55-0000-4000-8000-00000000a205';
      const replyTime = new Date('2026-06-05T09:00:00.000Z');
      await prisma.conversationHistory.create({
        data: {
          id: replyRow,
          channelId: weighInChannel,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'WEIGH-IN',
          discordMessageId: ['444444444444444450'],
          createdAt: replyTime,
        },
      });
      await prisma.memory.createMany({
        data: [
          {
            id: weighInMemory,
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: '{user}: nudge\n{assistant}: WEIGH-IN',
            messageIds: [],
            senders: ['rerolluser'],
            createdAt: new Date(replyTime.getTime() + 60_000),
          },
          {
            // Same persona and personality, different reply text: another exchange.
            id: '7c1e9b55-0000-4000-8000-00000000a206',
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: '{user}: nudge\n{assistant}: SOMETHING-ELSE',
            messageIds: [],
            senders: ['rerolluser'],
            createdAt: new Date(replyTime.getTime() + 120_000),
          },
        ],
      });

      const { json } = await check(OWNER_DISCORD, '444444444444444450');

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: null,
          memoryPlan: { kind: 'remove', memoryIds: [weighInMemory], pendingIds: [] },
        })
      );
    });
  });

  describe('reroll commit', () => {
    it('soft-deletes the old row and creates the new row with the old row position', async () => {
      const { json } = await commit(
        commitBody({
          thinkingContent: 'pondering',
          incognito: true,
          discordMessageIds: [REPLY_A_DISCORD_ID, '444444444444444409'],
        })
      );

      const newId = generateRerolledConversationHistoryUuid(REPLY_A_ROW, 'attempt-1');
      expect(json).toHaveBeenCalledWith({ id: newId, removedMemories: 1 });
      const old = await prisma.conversationHistory.findUniqueOrThrow({
        where: { id: REPLY_A_ROW },
      });
      expect(old.deletedAt).not.toBeNull();
      const fresh = await prisma.conversationHistory.findUniqueOrThrow({ where: { id: newId } });
      expect(fresh).toMatchObject({
        channelId: CHANNEL,
        personalityId: PERSONALITY_A,
        personaId: OWNER_PERSONA,
        role: 'assistant',
        content: 'NEW-A',
        discordMessageId: [REPLY_A_DISCORD_ID, '444444444444444409'],
        thinkingContent: 'pondering',
        deletedAt: null,
        messageMetadata: { incognito: true },
      });
      expect(fresh.createdAt.toISOString()).toBe(REPLY_A_TIME.toISOString());
      expect(fresh.tokenCount).toBeGreaterThan(0);
    });

    it('gives a new id that differs from the old id and from a second attempt', async () => {
      const first = generateRerolledConversationHistoryUuid(REPLY_A_ROW, 'attempt-1');
      const second = generateRerolledConversationHistoryUuid(REPLY_A_ROW, 'attempt-2');

      expect(first).not.toBe(REPLY_A_ROW);
      expect(first).not.toBe(second);
    });

    it('removes only this row planned memories when two personalities share a trigger', async () => {
      await commit(commitBody());

      expect(await visibility(MEMORY_A)).toBe('deleted');
      expect(await visibility(MEMORY_B)).toBe('normal');
    });

    it('keeps the new reply memory and removes the old one', async () => {
      await prisma.memory.create({
        data: {
          id: NEW_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: NEW-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      });

      const { json } = await commit(commitBody({ newMemoryIds: [NEW_MEMORY] }));

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ removedMemories: 1 }));
      expect(await visibility(MEMORY_A)).toBe('deleted');
      expect(await visibility(NEW_MEMORY)).toBe('normal');
    });

    it('keeps the memory when an identical-text reroll dedupes onto the old memory id', async () => {
      const { json } = await commit(commitBody({ content: 'OLD-A', newMemoryIds: [MEMORY_A] }));

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ removedMemories: 0 }));
      expect(await visibility(MEMORY_A)).toBe('normal');
    });

    it('revives a memory an earlier aborted attempt left deleted when a later attempt reports the same id', async () => {
      await prisma.memory.create({
        data: {
          id: NEW_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: NEW-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      });
      await abort({
        rowId: REPLY_A_ROW,
        attemptId: 'attempt-2',
        jobId: 'job-2',
        newMemoryIds: [NEW_MEMORY],
        newPendingIds: [],
        keepMemoryIds: [],
      });
      expect(await visibility(NEW_MEMORY)).toBe('deleted');

      // The identical-text attempt's insert was a no-op, but it reports the id.
      const { json } = await commit(
        commitBody({ attemptId: 'attempt-3', jobId: 'job-3', newMemoryIds: [NEW_MEMORY] })
      );

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ removedMemories: 1 }));
      expect(await visibility(NEW_MEMORY)).toBe('normal');
      expect(await visibility(MEMORY_A)).toBe('deleted');
    });

    it('removes the old pending row too', async () => {
      await prisma.memory.deleteMany({ where: { id: MEMORY_A } });
      await prisma.pendingMemory.create({
        data: {
          id: NEW_PENDING,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          text: '{user}: hi\n{assistant}: OLD-A',
          metadata: { messageIds: [TRIGGER_DISCORD_ID] },
        },
      });

      await commit(commitBody());

      expect(await prisma.pendingMemory.count({ where: { id: NEW_PENDING } })).toBe(0);
    });

    it('finds and removes an untriggered weigh-in memory', async () => {
      const weighInChannel = '123456789012345681';
      const replyRow = '7c1e9b55-0000-4000-8000-00000000a108';
      const weighInMemory = '7c1e9b55-0000-4000-8000-00000000a207';
      const replyTime = new Date('2026-06-05T10:00:00.000Z');
      await prisma.conversationHistory.create({
        data: {
          id: replyRow,
          channelId: weighInChannel,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'WEIGH-IN',
          discordMessageId: ['444444444444444451'],
          createdAt: replyTime,
        },
      });
      await prisma.memory.create({
        data: {
          id: weighInMemory,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: nudge\n{assistant}: WEIGH-IN',
          messageIds: [],
          senders: ['rerolluser'],
          createdAt: new Date(replyTime.getTime() + 60_000),
        },
      });

      const { json } = await commit(
        commitBody({ rowId: replyRow, discordMessageIds: ['444444444444444451'] }),
        '444444444444444451'
      );

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ removedMemories: 1 }));
      expect(await visibility(weighInMemory)).toBe('deleted');
    });

    it('refuses when the reply is no longer the latest', async () => {
      await prisma.conversationHistory.create({
        data: {
          id: '7c1e9b55-0000-4000-8000-00000000a109',
          channelId: CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'NEWER-A',
          discordMessageId: ['444444444444444498'],
          createdAt: new Date('2026-06-04T12:05:00.000Z'),
        },
      });
      const before = await snapshot();

      const { status, json } = await commit(commitBody());

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_LATEST' }));
      expect(await snapshot()).toEqual(before);
    });

    it('refuses when the memory became blocked', async () => {
      await prisma.memory.update({ where: { id: MEMORY_A }, data: { isLocked: true } });
      const before = await snapshot();

      const { status, json } = await commit(commitBody());

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MEMORY_BLOCKED' }));
      expect(await snapshot()).toEqual(before);
    });

    it("removes another persona's sibling memory of a coalesced reply and counts it", async () => {
      const siblingMemory = '7c1e9b55-0000-4000-8000-00000000a205';
      await prisma.conversationHistory.create({
        data: {
          id: '7c1e9b55-0000-4000-8000-00000000a107',
          channelId: CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OTHER_PERSONA,
          role: 'user',
          content: 'yo',
          discordMessageId: ['666666666666666602'],
          createdAt: new Date('2026-06-04T12:00:03.000Z'),
        },
      });
      await prisma.memory.create({
        data: {
          id: siblingMemory,
          personaId: OTHER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: yo\n{assistant}: OLD-A',
          messageIds: ['666666666666666602'],
          senders: ['otherroll'],
        },
      });

      const { json } = await commit(commitBody());

      expect(await visibility(siblingMemory)).toBe('deleted');
      expect(await visibility(MEMORY_A)).toBe('deleted');
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ removedMemories: 2 }));
    });

    it('refuses when the row changed (already replaced)', async () => {
      await commit(commitBody());

      const { status, json } = await commit(commitBody({ attemptId: 'attempt-2' }));

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ROW_CHANGED' }));
    });

    it('refuses a non-owner commit as a changed row without touching data', async () => {
      const before = await snapshot();

      const { status } = await call(
        handleRerollAssistantMessage,
        OTHER_DISCORD,
        REPLY_A_DISCORD_ID,
        commitBody()
      );

      expect(status).toHaveBeenCalledWith(409);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('reroll abort', () => {
    async function seedNew() {
      await prisma.memory.create({
        data: {
          id: NEW_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: NEW-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      });
      await prisma.pendingMemory.create({
        data: {
          id: NEW_PENDING,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          text: '{user}: hi\n{assistant}: NEW-A',
          metadata: { messageIds: [TRIGGER_DISCORD_ID] },
        },
      });
    }

    it('removes the new ids minus the keep ids', async () => {
      await seedNew();

      const { json } = await abort({
        rowId: REPLY_A_ROW,
        attemptId: 'attempt-1',
        jobId: 'job-1',
        newMemoryIds: [NEW_MEMORY, MEMORY_A],
        newPendingIds: [NEW_PENDING],
        keepMemoryIds: [MEMORY_A],
      });

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ removedMemories: 1, committed: false })
      );
      expect(await visibility(NEW_MEMORY)).toBe('deleted');
      expect(await visibility(MEMORY_A)).toBe('normal');
      expect(await prisma.pendingMemory.count({ where: { id: NEW_PENDING } })).toBe(0);
    });

    it("never touches a memory outside the row's persona and personality", async () => {
      const { json } = await abort({
        rowId: REPLY_A_ROW,
        attemptId: 'attempt-1',
        jobId: 'job-1',
        newMemoryIds: [MEMORY_B],
        newPendingIds: [],
        keepMemoryIds: [],
      });

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ removedMemories: 0, committed: false })
      );
      expect(await visibility(MEMORY_B)).toBe('normal');
    });

    it('404s a non-owner and removes nothing', async () => {
      await seedNew();

      const { status } = await call(
        handleAbortRerollAssistantMessage,
        OTHER_DISCORD,
        REPLY_A_DISCORD_ID,
        {
          rowId: REPLY_A_ROW,
          attemptId: 'attempt-1',
          jobId: 'job-1',
          newMemoryIds: [NEW_MEMORY],
          newPendingIds: [],
          keepMemoryIds: [],
        }
      );

      expect(status).toHaveBeenCalledWith(404);
      expect(await visibility(NEW_MEMORY)).toBe('normal');
    });
  });

  describe('review round 1', () => {
    const HOUR = 60 * 60 * 1000;
    const ORPHAN_MEMORY = '7c1e9b55-0000-4000-8000-00000000a208';
    const WEIGH_IN_CHANNEL = '123456789012345690';
    const WEIGH_IN_ROW = '7c1e9b55-0000-4000-8000-00000000a110';
    const WEIGH_IN_DISCORD_ID = '444444444444444460';
    const WEIGH_IN_MEMORY = '7c1e9b55-0000-4000-8000-00000000a209';
    const WEIGH_IN_TIME = new Date('2026-06-05T09:00:00.000Z');

    /** The prisma `$transaction` entry point, as the spy helpers below replace it. */
    type TransactionFn = (fn: unknown) => Promise<unknown>;

    async function seedRerolledWeighIn(memoryLocked: boolean) {
      // A weigh-in whose reroll committed long after the original: the row kept
      // its old createdAt, the reroll's memory is stamped at store time.
      await prisma.conversationHistory.create({
        data: {
          id: WEIGH_IN_ROW,
          channelId: WEIGH_IN_CHANNEL,
          personalityId: PERSONALITY_A,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'WEIGH-IN-2',
          discordMessageId: [WEIGH_IN_DISCORD_ID],
          createdAt: WEIGH_IN_TIME,
        },
      });
      await prisma.memory.create({
        data: {
          id: WEIGH_IN_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: nudge\n{assistant}: WEIGH-IN-2',
          messageIds: [],
          senders: ['rerolluser'],
          isLocked: memoryLocked,
          createdAt: new Date(WEIGH_IN_TIME.getTime() + 2 * HOUR),
        },
      });
    }

    async function seedOrphan(createdAt: Date) {
      await prisma.memory.create({
        data: {
          id: ORPHAN_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: ABANDONED',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
          createdAt,
        },
      });
    }

    it('F3: finds an untriggered memory written long after the row was created', async () => {
      await seedRerolledWeighIn(false);

      const { json } = await check(OWNER_DISCORD, WEIGH_IN_DISCORD_ID);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryPlan: { kind: 'remove', memoryIds: [WEIGH_IN_MEMORY], pendingIds: [] },
        })
      );
    });

    it('F3: a locked untriggered memory written long after the row refuses', async () => {
      await seedRerolledWeighIn(true);

      const { json } = await check(OWNER_DISCORD, WEIGH_IN_DISCORD_ID);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ memoryPlan: { kind: 'blocked', reason: 'locked' } })
      );
    });

    it('F3: unrelated empty-messageIds memories do not hide the real one from the bounded read', async () => {
      await seedRerolledWeighIn(false);
      for (let i = 0; i < 5; i++) {
        await prisma.memory.create({
          data: {
            id: `7c1e9b55-0000-4000-8000-00000000b30${i}`,
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: `{user}: other${i}\n{assistant}: UNRELATED-${i}`,
            messageIds: [],
            senders: ['rerolluser'],
            createdAt: new Date(WEIGH_IN_TIME.getTime() + i * 1000),
          },
        });
      }

      const { json } = await check(OWNER_DISCORD, WEIGH_IN_DISCORD_ID);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryPlan: { kind: 'remove', memoryIds: [WEIGH_IN_MEMORY], pendingIds: [] },
        })
      );
    });

    it('F5: a retried commit after success answers success and changes nothing', async () => {
      await commit(commitBody());
      const before = await snapshot();

      const { status, json } = await commit(commitBody());

      expect(status).not.toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({
        id: generateRerolledConversationHistoryUuid(REPLY_A_ROW, 'attempt-1'),
        removedMemories: 0,
      });
      expect(await snapshot()).toEqual(before);
    });

    it('F5: an abort after a landed commit removes nothing and reports committed', async () => {
      await prisma.memory.create({
        data: {
          id: NEW_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: NEW-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      });
      await commit(commitBody({ newMemoryIds: [NEW_MEMORY] }));

      const { json } = await abort({
        rowId: REPLY_A_ROW,
        attemptId: 'attempt-1',
        jobId: 'job-1',
        newMemoryIds: [NEW_MEMORY],
        newPendingIds: [],
        keepMemoryIds: [],
      });

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          removedMemories: 0,
          committed: true,
          oldRowLive: false,
          oldRowContentDigest: null,
        })
      );
      expect(await visibility(NEW_MEMORY)).toBe('normal');
    });

    it('F4: a stale orphan memory under the trigger does not block the plan and is removed by the commit', async () => {
      await seedOrphan(new Date(Date.now() - 2 * HOUR));

      const checked = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);
      expect(checked.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryPlan: { kind: 'remove', memoryIds: [MEMORY_A, ORPHAN_MEMORY], pendingIds: [] },
        })
      );

      const { json } = await commit(commitBody());

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ removedMemories: 2 }));
      expect(await visibility(ORPHAN_MEMORY)).toBe('deleted');
      expect(await visibility(MEMORY_A)).toBe('deleted');
    });

    it('F4: a young orphan memory is neither planned nor removed', async () => {
      await seedOrphan(new Date(Date.now() - 60_000));

      const checked = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);
      expect(checked.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryPlan: { kind: 'remove', memoryIds: [MEMORY_A], pendingIds: [] },
        })
      );

      await commit(commitBody());

      expect(await visibility(ORPHAN_MEMORY)).toBe('normal');
    });

    it('F4: two memories holding the reply text stay ambiguous', async () => {
      await prisma.memory.create({
        data: {
          id: ORPHAN_MEMORY,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: OLD-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
          createdAt: new Date(Date.now() - 2 * HOUR),
        },
      });

      const { json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ memoryPlan: { kind: 'blocked', reason: 'ambiguous' } })
      );
    });

    describe('F6 6A: a newer row of any role refuses', () => {
      beforeEach(async () => {
        await prisma.conversationHistory.create({
          data: {
            id: '7c1e9b55-0000-4000-8000-00000000a111',
            channelId: CHANNEL,
            personalityId: PERSONALITY_A,
            personaId: OTHER_PERSONA,
            role: 'user',
            content: 'next message',
            discordMessageId: ['666666666666666610'],
            createdAt: new Date('2026-06-04T12:01:00.000Z'),
          },
        });
      });

      it('on check', async () => {
        const { status, json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_LATEST' }));
      });

      it('on commit, without writing', async () => {
        const before = await snapshot();

        const { status, json } = await commit(commitBody());

        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_LATEST' }));
        expect(await snapshot()).toEqual(before);
      });
    });

    it('F9: a memory locked between planning and commit refuses and rolls back', async () => {
      const realTransaction = prisma.$transaction.bind(prisma) as unknown as TransactionFn;
      const spy = vi
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(((fn: unknown) =>
          prisma.memory
            .update({ where: { id: MEMORY_A }, data: { isLocked: true } })
            .then(() => realTransaction(fn))) as unknown as typeof prisma.$transaction);
      try {
        const { status, json } = await commit(commitBody());

        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MEMORY_BLOCKED' }));
        const old = await prisma.conversationHistory.findFirst({
          where: { id: REPLY_A_ROW },
          select: { deletedAt: true },
        });
        expect(old?.deletedAt).toBeNull();
        expect(await prisma.conversationHistory.count({ where: { content: 'NEW-A' } })).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('commit race: both requests pass the pre-transaction find and the loser hits the in-transaction guard', async () => {
      const realTransaction = prisma.$transaction.bind(prisma) as unknown as TransactionFn;
      let entered = 0;
      let release: () => void = () => undefined;
      const bothEntered = new Promise<void>(resolve => {
        release = resolve;
      });
      const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (fn: unknown) => {
        entered += 1;
        if (entered === 2) {
          release();
        }
        await bothEntered;
        return realTransaction(fn);
      }) as unknown as typeof prisma.$transaction);
      try {
        const results = await Promise.all([
          commit(commitBody({ attemptId: 'attempt-1' })),
          commit(commitBody({ attemptId: 'attempt-2' })),
        ]);

        // Two commit transactions (both reach the in-transaction guard) plus the
        // winner's sweep; the loser rolled back before any sweep.
        expect(spy).toHaveBeenCalledTimes(3);
        const conflicts = results.filter(r => r.status.mock.calls.some(c => c[0] === 409));
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'ROW_CHANGED' })
        );
        const live = await prisma.conversationHistory.findMany({
          where: { personalityId: PERSONALITY_A, role: 'assistant', deletedAt: null },
          select: { id: true },
          take: 10,
        });
        expect(live).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('review round 2', () => {
    const HOUR = 60 * 60 * 1000;
    const NEW_DISCORD_ID = '444444444444444411';
    const CHUNK_GROUP = '7c1e9b55-0000-4000-8000-00000000a501';
    const chunkId = (i: number) => `7c1e9b55-0000-4000-8000-00000000a51${i}`;
    const SIBLING_MEMORY = '7c1e9b55-0000-4000-8000-00000000a209';

    async function seedNewMemory(id = NEW_MEMORY) {
      await prisma.memory.create({
        data: {
          id,
          personaId: OWNER_PERSONA,
          personalityId: PERSONALITY_A,
          content: '{user}: hi\n{assistant}: NEW-A',
          messageIds: [TRIGGER_DISCORD_ID],
          senders: ['rerolluser'],
        },
      });
    }

    const abortBody = (overrides: Record<string, unknown> = {}) => ({
      rowId: REPLY_A_ROW,
      attemptId: 'attempt-1',
      jobId: 'job-1',
      newMemoryIds: [NEW_MEMORY],
      newPendingIds: [],
      keepMemoryIds: [],
      ...overrides,
    });

    /** The stored result of a reroll generation job, as the worker's `persistAndPublishResult` writes it. */
    async function seedJobResult(
      listed: { memoryIds: string[]; pendingIds: string[] },
      over: {
        jobId?: string;
        rowId?: string;
        attemptId?: string;
        status?: string;
        completedAt?: Date;
      } = {}
    ) {
      const jobId = over.jobId ?? 'job-1';
      await prisma.jobResult.create({
        data: {
          jobId,
          requestId: `req-${jobId}`,
          status: over.status ?? 'PENDING_DELIVERY',
          completedAt: over.completedAt ?? new Date(),
          result: {
            requestId: `req-${jobId}`,
            success: true,
            metadata: {
              rerollMemory: {
                rowId: over.rowId ?? REPLY_A_ROW,
                attemptId: over.attemptId ?? 'attempt-1',
                ...listed,
              },
            },
          },
        },
      });
    }

    /** Seed by raw SQL: the Prisma update path for this column is lint-forbidden. */
    async function seedOldRowMetadata(metadata: Record<string, unknown>) {
      const json = JSON.stringify(metadata);
      await prisma.$executeRaw`UPDATE conversation_history SET message_metadata = ${json}::jsonb WHERE id = ${REPLY_A_ROW}::uuid`;
    }

    async function oldRowMetadata() {
      const row = await prisma.conversationHistory.findUniqueOrThrow({
        where: { id: REPLY_A_ROW },
        select: { messageMetadata: true, deletedAt: true },
      });
      return row;
    }

    describe('M2: abort and commit serialize on the old row', () => {
      it('commit first: the abort reports committed and the new memories stay', async () => {
        await seedNewMemory();
        await commit(commitBody({ newMemoryIds: [NEW_MEMORY] }));

        const { json } = await abort(abortBody());

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            removedMemories: 0,
            committed: true,
            oldRowLive: false,
            oldRowContentDigest: null,
          })
        );
        expect(await visibility(NEW_MEMORY)).toBe('normal');
      });

      it('abort first: the memories are removed and the commit refuses ATTEMPT_ABORTED', async () => {
        await seedNewMemory();
        const aborted = await abort(abortBody());

        const { status, json } = await commit(commitBody({ newMemoryIds: [NEW_MEMORY] }));

        expect(aborted.json).toHaveBeenCalledWith(
          expect.objectContaining({ removedMemories: 1, committed: false })
        );
        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ATTEMPT_ABORTED' }));
        expect((await oldRowMetadata()).deletedAt).toBeNull();
        expect(await visibility(MEMORY_A)).toBe('normal');
      });

      it('an attempt with no new memory ids (incognito) is refused after its abort all the same', async () => {
        await abort(abortBody({ newMemoryIds: [] }));

        const { json } = await commit(commitBody({ incognito: true }));

        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ATTEMPT_ABORTED' }));
        expect((await oldRowMetadata()).deletedAt).toBeNull();
      });

      it('a tombstone for one attempt does not stop another attempt committing', async () => {
        await abort(abortBody({ newMemoryIds: [] }));

        const { status } = await commit(commitBody({ attemptId: 'attempt-2' }));

        expect(status).not.toHaveBeenCalledWith(409);
        expect((await oldRowMetadata()).deletedAt).not.toBeNull();
      });

      it('racing the two requests leaves exactly one outcome, never a committed row with deleted memories', async () => {
        await seedNewMemory();

        const [committed, aborted] = await Promise.all([
          commit(commitBody({ newMemoryIds: [NEW_MEMORY] })),
          abort(abortBody()),
        ]);

        const commitRefused = committed.json.mock.calls.some(
          c => (c[0] as { code?: string }).code === 'ATTEMPT_ABORTED'
        );
        const live = await prisma.conversationHistory.findMany({
          where: { personalityId: PERSONALITY_A, role: 'assistant', deletedAt: null },
          select: { id: true },
          take: 10,
        });
        if (commitRefused) {
          expect(await visibility(NEW_MEMORY)).toBe('deleted');
          expect(live.map(row => row.id)).toEqual([REPLY_A_ROW]);
        } else {
          expect(aborted.json).toHaveBeenCalledWith(
            expect.objectContaining({ removedMemories: 0, committed: true, oldRowLive: false })
          );
          expect(await visibility(NEW_MEMORY)).toBe('normal');
          expect(live).toHaveLength(1);
          expect(live[0].id).not.toBe(REPLY_A_ROW);
        }
      });

      it('keeps the old row other metadata and only the last 10 tombstones', async () => {
        await seedOldRowMetadata({ incognito: true, incognitoKind: 'session' });
        for (let i = 0; i < 12; i++) {
          await abort(abortBody({ attemptId: `attempt-${i}`, newMemoryIds: [] }));
        }

        const { messageMetadata } = await oldRowMetadata();

        expect(messageMetadata).toEqual({
          incognito: true,
          incognitoKind: 'session',
          abortedRerollAttempts: Array.from({ length: 10 }, (_, i) => `attempt-${i + 2}`),
        });
      });
    });

    describe('M1 + incognito kind on the committed row', () => {
      it('a non-incognito reroll writes incognito:false, so its own reroll reads as non-incognito', async () => {
        await commit(commitBody({ discordMessageIds: [NEW_DISCORD_ID] }));

        const { json } = await check(OWNER_DISCORD, NEW_DISCORD_ID);

        const reported = json.mock.calls[0][0] as { incognito: boolean; incognitoKind?: string };
        expect(reported.incognito).toBe(false);
        expect(reported).not.toHaveProperty('incognitoKind');
        const row = await prisma.conversationHistory.findFirstOrThrow({
          where: { discordMessageId: { has: NEW_DISCORD_ID } },
          select: { messageMetadata: true },
        });
        expect(row.messageMetadata).toEqual({ incognito: false });
      });

      it('the message lookup behind `resolved.incognito` reads the committed row as false, not as a legacy null', async () => {
        await commit(commitBody({ discordMessageIds: [NEW_DISCORD_ID] }));

        const json = vi.fn().mockReturnThis();
        const status = vi.fn().mockReturnThis();
        await asRouteHandler(
          handleLookupPersonalityFromMessage({
            ...stubRouteResolvers(),
            prisma,
          } as unknown as RouteDeps)
        )(
          { query: { discordMessageId: NEW_DISCORD_ID }, params: {} } as unknown as Request,
          { status, json } as unknown as Response
        );

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ role: 'assistant', incognito: false })
        );
      });

      it('the kind survives a commit and a second reroll copies it', async () => {
        await seedOldRowMetadata({ incognito: true, incognitoKind: 'session' });
        await commit(commitBody({ discordMessageIds: [NEW_DISCORD_ID] }));
        const second = await check(OWNER_DISCORD, NEW_DISCORD_ID);

        expect(second.json).toHaveBeenCalledWith(
          expect.objectContaining({ incognito: true, incognitoKind: 'session' })
        );
      });

      it('writes the kind the body names beside incognito:true', async () => {
        await commit(
          commitBody({
            discordMessageIds: [NEW_DISCORD_ID],
            incognito: true,
            incognitoKind: 'summon',
          })
        );

        const row = await prisma.conversationHistory.findFirstOrThrow({
          where: { discordMessageId: { has: NEW_DISCORD_ID } },
          select: { messageMetadata: true },
        });
        expect(row.messageMetadata).toEqual({ incognito: true, incognitoKind: 'summon' });
      });
    });

    describe('H1: chunked and multi-row memories block again', () => {
      async function seedChunks(texts: string[]) {
        await prisma.memory.deleteMany({ where: { id: MEMORY_A } });
        await prisma.memory.createMany({
          data: texts.map((reply, i) => ({
            id: chunkId(i),
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: `{user}: hi\n{assistant}: ${reply}`,
            messageIds: [TRIGGER_DISCORD_ID],
            senders: ['rerolluser'],
            chunkGroupId: CHUNK_GROUP,
            chunkIndex: i,
            totalChunks: texts.length,
          })),
        });
      }

      it.each([
        ['no chunk text matches', ['x', 'y', 'z']],
        ['one chunk text matches the reply', ['OLD-A', 'y', 'z']],
      ])('a 3-row chunk group blocks the check and the commit when %s', async (_name, texts) => {
        await seedChunks(texts);

        const checked = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);
        const committed = await commit(commitBody());

        expect(checked.json).toHaveBeenCalledWith(
          expect.objectContaining({ memoryPlan: { kind: 'blocked', reason: 'chunked' } })
        );
        expect(committed.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'MEMORY_BLOCKED' })
        );
        expect((await oldRowMetadata()).deletedAt).toBeNull();
      });

      it('a page full of rows blocks as ambiguous even beside the exact match (L2)', async () => {
        for (let i = 0; i < 10; i++) {
          await prisma.memory.create({
            data: {
              id: `7c1e9b55-0000-4000-8000-00000000a52${i}`,
              personaId: OWNER_PERSONA,
              personalityId: PERSONALITY_A,
              content: `{user}: hi\n{assistant}: ABANDONED-${i}`,
              messageIds: [TRIGGER_DISCORD_ID],
              senders: ['rerolluser'],
              createdAt: new Date(Date.now() - 2 * HOUR - i),
            },
          });
        }

        const { json } = await check(OWNER_DISCORD, REPLY_A_DISCORD_ID);

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ memoryPlan: { kind: 'blocked', reason: 'ambiguous' } })
        );
      });
    });

    describe('a commit sweeps the row’s abandoned attempts found through job_results', () => {
      const OLD_ABANDONED = '7c1e9b55-0000-4000-8000-00000000a601';
      const YOUNG_ABANDONED = '7c1e9b55-0000-4000-8000-00000000a602';
      const OTHER_ROW_ABANDONED = '7c1e9b55-0000-4000-8000-00000000a603';
      const LOCKED_ABANDONED = '7c1e9b55-0000-4000-8000-00000000a604';
      const OLD_PENDING = '7c1e9b55-0000-4000-8000-00000000a701';
      const LONG_AGO = new Date(Date.now() - 2 * HOUR);

      const seedMemory = (id: string, over: { persona?: string; isLocked?: boolean } = {}) =>
        prisma.memory.create({
          data: {
            id,
            personaId: over.persona ?? OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: `{user}: hi\n{assistant}: ABANDONED ${id.slice(-4)}`,
            messageIds: [],
            senders: ['rerolluser'],
            isLocked: over.isLocked ?? false,
          },
        });
      const jobStatus = async (jobId: string) =>
        (await prisma.jobResult.findUniqueOrThrow({ where: { jobId }, select: { status: true } }))
          .status;

      it('cleans an untriggered abandoned attempt, any persona, and marks its result delivered', async () => {
        await prisma.conversationHistory.deleteMany({
          where: { id: { in: [TRIGGER_ROW, TRIGGER_B_ROW] } },
        });
        await seedMemory(OLD_ABANDONED, { persona: OTHER_PERSONA });
        await prisma.pendingMemory.create({
          data: {
            id: OLD_PENDING,
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            text: '{user}: hi\n{assistant}: ABANDONED',
            metadata: {},
          },
        });
        await seedJobResult(
          { memoryIds: [OLD_ABANDONED], pendingIds: [OLD_PENDING] },
          { jobId: 'job-old', attemptId: 'attempt-old', completedAt: LONG_AGO }
        );

        await commit(commitBody());

        expect(await visibility(OLD_ABANDONED)).toBe('deleted');
        expect(await prisma.pendingMemory.count({ where: { id: OLD_PENDING } })).toBe(0);
        expect(await jobStatus('job-old')).toBe('DELIVERED');
      });

      it('young abandoned attempt is swept too: once the commit landed, no age filter protects it', async () => {
        await seedMemory(YOUNG_ABANDONED);
        await seedJobResult(
          { memoryIds: [YOUNG_ABANDONED], pendingIds: [] },
          { jobId: 'job-young', attemptId: 'attempt-young', completedAt: new Date() }
        );

        await commit(commitBody());

        expect(await visibility(YOUNG_ABANDONED)).toBe('deleted');
        expect(await jobStatus('job-young')).toBe('DELIVERED');
      });

      it('a still-running attempt whose memories are swept: its own later commit is refused ROW_CHANGED and its abort removes nothing extra', async () => {
        await seedMemory(NEW_MEMORY);
        await seedMemory(YOUNG_ABANDONED);
        // The committer's reply and the still-running attempt's list the same
        // content-addressed memory (an identical reply text); the running one also has its own.
        await seedJobResult({ memoryIds: [NEW_MEMORY], pendingIds: [] }, { jobId: 'job-1' });
        await seedJobResult(
          { memoryIds: [NEW_MEMORY, YOUNG_ABANDONED], pendingIds: [] },
          { jobId: 'job-young', attemptId: 'attempt-young', completedAt: new Date() }
        );

        await commit(commitBody({ newMemoryIds: [NEW_MEMORY] }));
        expect(await visibility(YOUNG_ABANDONED)).toBe('deleted');
        expect(await visibility(NEW_MEMORY)).toBe('normal');

        const late = await commit(
          commitBody({
            attemptId: 'attempt-young',
            jobId: 'job-young',
            newMemoryIds: [NEW_MEMORY, YOUNG_ABANDONED],
          })
        );
        expect(late.status).toHaveBeenCalledWith(409);
        expect(late.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ROW_CHANGED' }));

        const { json } = await abort(
          abortBody({
            attemptId: 'attempt-young',
            jobId: 'job-young',
            newMemoryIds: [NEW_MEMORY, YOUNG_ABANDONED],
          })
        );
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ committed: false, oldRowLive: false })
        );
        // The committed reply's memory survives the late abort.
        expect(await visibility(NEW_MEMORY)).toBe('normal');
      });

      it('leaves another row’s attempt and a locked memory alone', async () => {
        await seedMemory(OTHER_ROW_ABANDONED);
        await seedMemory(LOCKED_ABANDONED, { isLocked: true });
        await seedJobResult(
          { memoryIds: [OTHER_ROW_ABANDONED], pendingIds: [] },
          {
            jobId: 'job-other-row',
            attemptId: 'attempt-x',
            rowId: REPLY_B_ROW,
            completedAt: LONG_AGO,
          }
        );
        await seedJobResult(
          { memoryIds: [LOCKED_ABANDONED], pendingIds: [] },
          { jobId: 'job-locked', attemptId: 'attempt-locked', completedAt: LONG_AGO }
        );

        await commit(commitBody());

        expect(await visibility(OTHER_ROW_ABANDONED)).toBe('normal');
        expect(await visibility(LOCKED_ABANDONED)).toBe('normal');
        expect(await jobStatus('job-other-row')).toBe('PENDING_DELIVERY');
      });

      it('sweeps an attempt whose result was already DELIVERED (a duplicate or an unknown abort), never this job', async () => {
        await seedMemory(OLD_ABANDONED);
        await seedMemory(NEW_MEMORY);
        await seedJobResult(
          { memoryIds: [OLD_ABANDONED], pendingIds: [] },
          { jobId: 'job-old', attemptId: 'attempt-old', status: 'DELIVERED', completedAt: LONG_AGO }
        );
        // This job's own result lists the new reply's memory and would be swept if it were not excluded.
        await seedJobResult(
          { memoryIds: [NEW_MEMORY], pendingIds: [] },
          { jobId: 'job-1', completedAt: LONG_AGO }
        );

        await commit(commitBody({ newMemoryIds: [NEW_MEMORY] }));

        expect(await visibility(OLD_ABANDONED)).toBe('deleted');
        expect(await visibility(NEW_MEMORY)).toBe('normal');
        expect(await jobStatus('job-1')).toBe('PENDING_DELIVERY');
      });

      it('never removes a memory the committing attempt also lists (an identical reply dedupes onto it)', async () => {
        await seedMemory(NEW_MEMORY);
        await seedJobResult(
          { memoryIds: [NEW_MEMORY], pendingIds: [] },
          { jobId: 'job-old', attemptId: 'attempt-old', completedAt: LONG_AGO }
        );
        await seedJobResult({ memoryIds: [NEW_MEMORY], pendingIds: [] }, { jobId: 'job-1' });

        await commit(commitBody());

        expect(await visibility(NEW_MEMORY)).toBe('normal');
      });
    });

    describe('what an abort reports about the old row', () => {
      it('a live old row: oldRowLive true and the sha256 of its stored content', async () => {
        const { json } = await abort(abortBody());

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            committed: false,
            oldRowLive: true,
            oldRowContentDigest: sha256Hex(
              (
                await prisma.conversationHistory.findUniqueOrThrow({
                  where: { id: REPLY_A_ROW },
                  select: { content: true },
                })
              ).content
            ),
          })
        );
      });

      it('an old row replaced by another attempt: oldRowLive false, no digest', async () => {
        await commit(commitBody({ attemptId: 'attempt-y', jobId: 'job-y' }));

        const { json } = await abort(abortBody());

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            committed: false,
            oldRowLive: false,
            oldRowContentDigest: null,
          })
        );
      });
    });

    describe('a late abort after another attempt committed with the same reply text', () => {
      it('leaves the memory the committed attempt also lists', async () => {
        await prisma.memory.create({
          data: {
            id: NEW_MEMORY,
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: '{user}: hi\n{assistant}: NEW-A',
            messageIds: [TRIGGER_DISCORD_ID],
            senders: ['rerolluser'],
          },
        });
        const listed = { memoryIds: [NEW_MEMORY], pendingIds: [] };
        await seedJobResult(listed, { jobId: 'job-x', attemptId: 'attempt-x' });
        await seedJobResult(listed, { jobId: 'job-y', attemptId: 'attempt-y' });
        await commit(commitBody({ attemptId: 'attempt-y', jobId: 'job-y' }));

        const { json } = await abort(abortBody({ attemptId: 'attempt-x', jobId: 'job-x' }));

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ committed: false, removedMemories: 0, oldRowLive: false })
        );
        expect(await visibility(NEW_MEMORY)).toBe('normal');
      });
    });

    describe('abort scope: the attempt ids come from job_results', () => {
      const seedSibling = () =>
        prisma.memory.create({
          data: {
            id: SIBLING_MEMORY,
            personaId: OTHER_PERSONA,
            personalityId: PERSONALITY_A,
            content: '{user}: hi\n{assistant}: NEW-A',
            messageIds: [TRIGGER_DISCORD_ID],
            senders: ['otherroll'],
          },
        });

      it('a forged id absent from the job result is not removed, even when named', async () => {
        await seedSibling();
        await seedJobResult({ memoryIds: [NEW_MEMORY], pendingIds: [] });

        const { json } = await abort(abortBody({ newMemoryIds: [SIBLING_MEMORY] }));

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ removedMemories: 0, committed: false })
        );
        expect(await visibility(SIBLING_MEMORY)).toBe('normal');
      });

      it('with no job result, another user is still never removed by a named id', async () => {
        await seedSibling();

        const { json } = await abort(abortBody({ newMemoryIds: [SIBLING_MEMORY] }));

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ removedMemories: 0, committed: false })
        );
        expect(await visibility(SIBLING_MEMORY)).toBe('normal');
      });

      it("a coalesced reroll's job result lists another user's memory: abort removes it", async () => {
        await seedSibling();
        await prisma.memory.create({
          data: {
            id: NEW_MEMORY,
            personaId: OWNER_PERSONA,
            personalityId: PERSONALITY_A,
            content: '{user}: hi\n{assistant}: NEW-A',
            messageIds: [TRIGGER_DISCORD_ID],
            senders: ['rerolluser'],
          },
        });
        await seedJobResult({ memoryIds: [NEW_MEMORY, SIBLING_MEMORY], pendingIds: [] });

        const { json } = await abort(abortBody({ newMemoryIds: [] }));

        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ removedMemories: 2, committed: false })
        );
        expect(await visibility(SIBLING_MEMORY)).toBe('deleted');
        expect(await visibility(NEW_MEMORY)).toBe('deleted');
      });
    });
  });
});
