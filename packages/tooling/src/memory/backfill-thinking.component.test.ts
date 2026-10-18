/**
 * Component test: `queryCandidateBatch` and `updateThinkingContent` over real PGLite.
 *
 * Exercises the SQL lateral pairing, persona filter, head-40 content guard,
 * chunk filter, and idempotent raw-SQL update against a real PostgreSQL engine.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import {
  classifyCandidateRow,
  queryCandidateBatch,
  updateThinkingContent,
} from './backfill-thinking.js';

const INITIAL_CURSOR = '00000000-0000-0000-0000-000000000000';

const USER_1 = '00000000-0000-4000-8000-000000000101';
const PERSONA_1 = '00000000-0000-4000-8000-000000000102';
const USER_2 = '00000000-0000-4000-8000-000000000103';
const PERSONA_2 = '00000000-0000-4000-8000-000000000104';
const PERSONALITY_ID = '00000000-0000-4000-8000-000000000105';
const PERSONALITY_2 = '00000000-0000-4000-8000-000000000106';

const MEMORY_1 = '00000000-0000-4000-8000-000000000201';
const MEMORY_2 = '00000000-0000-4000-8000-000000000202';

const HISTORY_1 = '00000000-0000-4000-8000-000000000301';
const HISTORY_2 = '00000000-0000-4000-8000-000000000302';
const HISTORY_3 = '00000000-0000-4000-8000-000000000303';

const CHANNEL_ID = '123456789012345678';
const MSG_ID_1 = '900000000000000001';
const MSG_ID_2 = '900000000000000002';

const BASE_TIME = new Date('2026-06-01T12:00:00.000Z');

describe('backfill-thinking SQL queries (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER_1,
      personaId: PERSONA_1,
      discordId: '111111111111111111',
      username: 'alice',
      personaName: 'Alice',
    });

    await seedUserWithPersona(prisma, {
      userId: USER_2,
      personaId: PERSONA_2,
      discordId: '222222222222222222',
      username: 'bob',
      personaName: 'Bob',
    });

    await prisma.personality.create({
      data: {
        id: PERSONALITY_ID,
        name: 'TestPersonality',
        slug: 'test-personality',
        ownerId: USER_1,
        characterInfo: 'A test personality',
        personalityTraits: 'Analytical',
      },
    });

    await prisma.personality.create({
      data: {
        id: PERSONALITY_2,
        name: 'OtherPersonality',
        slug: 'other-personality',
        ownerId: USER_1,
        characterInfo: 'A second personality',
        personalityTraits: 'Distinct',
      },
    });
  }, 30000);

  beforeEach(async () => {
    await prisma.memory.deleteMany();
    await prisma.conversationHistory.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  it('pairs a clean user→assistant turn and classifies it as write with the trace', async () => {
    const assistantReply =
      'The fortification sits atop a basalt ridge overlooking the northern valley.';
    const trace = 'Considered geography and defensive sightlines before answering.';

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Where is the fortification located?',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: assistantReply,
        thinkingContent: trace,
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: `Alice: Where is the fortification located?\nTestPersonality: ${assistantReply}`,
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: MEMORY_1,
      user_found: true,
      assistant_role: 'assistant',
      thinking_content: trace,
      guard_ok: true,
    });
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'write', trace });
  });

  it("pairs across another persona's user turn in the same channel and classifies as write", async () => {
    const assistantReply = 'Here is your answer after another persona spoke in this channel.';
    const trace = 'Matched the reply belonging to Persona 1 despite Persona 2 interleaving.';

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'First user question from Alice',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    // Another persona speaks in the same channel 500ms later
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_2,
        role: 'user',
        content: 'Unrelated interjection from Bob',
        discordMessageId: [MSG_ID_2],
        createdAt: new Date(BASE_TIME.getTime() + 500),
      },
    });

    // Persona 1's assistant reply arrives at +1500ms
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_3,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: assistantReply,
        thinkingContent: trace,
        createdAt: new Date(BASE_TIME.getTime() + 1500),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: `Alice: First user question from Alice\nTestPersonality: ${assistantReply}`,
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'write', trace });
  });

  it('classifies as interleaved when the next row of this persona is a user turn', async () => {
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'First message from Alice',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Follow-up message from Alice before assistant replied',
        discordMessageId: [MSG_ID_2],
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Alice: First message from Alice',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_found).toBe(true);
    expect(rows[0].assistant_role).toBe('user');
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'interleaved' });
  });

  it('classifies as no_reply when the user row has no reply row in the window', async () => {
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'User message with no assistant reply stored in window',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Alice: User message with no assistant reply stored in window',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_found).toBe(true);
    expect(rows[0].assistant_role).toBeNull();
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'no_reply' });
  });

  it('classifies as guard when the assistant content prefix does not appear in the memory', async () => {
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Tell me about the lantern.',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: 'This assistant reply text is completely absent from the stored memory.',
        thinkingContent: 'Trace that must not be written when guard fails.',
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Alice: Tell me about the lantern.\nTestPersonality: A brass oil lantern.',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].guard_ok).toBe(false);
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'guard' });
  });

  it('classifies as guard when the assistant content is empty', async () => {
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Hello there',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: '',
        thinkingContent: 'Trace on an empty-content assistant row.',
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Alice: Hello there',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].guard_ok).toBe(false);
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'guard' });
  });

  it('selects chunk 0 as a candidate and excludes chunk 1', async () => {
    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Chunk 0 memory content',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_2,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Chunk 1 memory content',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 1,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows.map(r => r.id)).toEqual([MEMORY_1]);
  });

  it("classifies as no_history when the memory's user row is absent", async () => {
    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Memory whose originating conversation_history row was swept',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_found).toBe(false);
    expect(rows[0].assistant_role).toBeNull();
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'no_history' });
  });

  it('updateThinkingContent writes once, returns 0 on a second call, and leaves updated_at unchanged', async () => {
    const initialUpdatedAt = new Date('2026-05-01T10:00:00.000Z');

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Memory awaiting thinking backfill',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
        createdAt: initialUpdatedAt,
        updatedAt: initialUpdatedAt,
      },
    });

    const firstWriteCount = await updateThinkingContent(prisma, MEMORY_1, 'first reasoning trace');
    expect(firstWriteCount).toBe(1);

    const secondWriteCount = await updateThinkingContent(
      prisma,
      MEMORY_1,
      'second reasoning trace that must not overwrite'
    );
    expect(secondWriteCount).toBe(0);

    const stored = await prisma.memory.findUniqueOrThrow({ where: { id: MEMORY_1 } });
    expect(stored.thinkingContent).toBe('first reasoning trace');
    expect(stored.updatedAt.toISOString()).toBe(initialUpdatedAt.toISOString());

    const remainingCandidates = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(remainingCandidates).toEqual([]);
  });

  it('pairs an unchunked memory (chunk_index NULL) as a candidate and classifies as write', async () => {
    const assistantReply = 'Unchunked memory reply text that satisfies the head-40 guard.';
    const trace = 'Reasoning trace for an unchunked memory row.';

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Prompt for unchunked memory',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: assistantReply,
        thinkingContent: trace,
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: `Alice: Prompt for unchunked memory\nTestPersonality: ${assistantReply}`,
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: null,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: MEMORY_1,
      user_found: true,
      assistant_role: 'assistant',
      thinking_content: trace,
      guard_ok: true,
    });
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'write', trace });
  });

  it("excludes a memory with source_system = 'external-import' from candidates", async () => {
    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Imported memory content',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        sourceSystem: 'external-import',
        chunkIndex: null,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toEqual([]);
  });

  it('does not pair a user row belonging to a different personality (no_history)', async () => {
    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_2,
        personaId: PERSONA_1,
        role: 'user',
        content: 'User message addressed to a different personality',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: 'Alice: User message addressed to a different personality',
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_found).toBe(false);
    expect(rows[0].assistant_role).toBeNull();
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'no_history' });
  });

  it('classifies a paired assistant row with a NULL trace as no_trace through the real SQL', async () => {
    const assistantReply = 'Assistant reply produced by a model without a reasoning trace.';

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Question with untraced reply',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: assistantReply,
        thinkingContent: null,
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: `Alice: Question with untraced reply\nTestPersonality: ${assistantReply}`,
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: MEMORY_1,
      user_found: true,
      assistant_role: 'assistant',
      thinking_content: null,
      guard_ok: true,
    });
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'no_trace' });
  });

  it('skips a soft-deleted assistant reply and classifies as no_reply when nothing else follows', async () => {
    const assistantReply = 'Soft-deleted assistant reply whose reasoning must not be copied.';

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Question followed by a deleted assistant reply',
        discordMessageId: [MSG_ID_1],
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: assistantReply,
        thinkingContent: 'Reasoning from a soft-deleted reply.',
        deletedAt: new Date(BASE_TIME.getTime() + 2000),
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: `Alice: Question followed by a deleted assistant reply\nTestPersonality: ${assistantReply}`,
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_found).toBe(true);
    expect(rows[0].assistant_role).toBeNull();
    expect(rows[0].thinking_content).toBeNull();
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'no_reply' });
  });

  it('skips a soft-deleted user row and classifies as no_history', async () => {
    const assistantReply = 'Assistant reply after a soft-deleted user message.';

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_1,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'user',
        content: 'Soft-deleted user message',
        discordMessageId: [MSG_ID_1],
        deletedAt: new Date(BASE_TIME.getTime() + 500),
        createdAt: BASE_TIME,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        id: HISTORY_2,
        channelId: CHANNEL_ID,
        personalityId: PERSONALITY_ID,
        personaId: PERSONA_1,
        role: 'assistant',
        content: assistantReply,
        thinkingContent: 'Reasoning for a turn whose user prompt was soft-deleted.',
        createdAt: new Date(BASE_TIME.getTime() + 1000),
      },
    });

    await prisma.memory.create({
      data: {
        id: MEMORY_1,
        personaId: PERSONA_1,
        personalityId: PERSONALITY_ID,
        content: `Alice: Soft-deleted user message\nTestPersonality: ${assistantReply}`,
        messageIds: [MSG_ID_1],
        senders: ['Alice'],
        chunkIndex: 0,
      },
    });

    const rows = await queryCandidateBatch(prisma, INITIAL_CURSOR, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_found).toBe(false);
    expect(rows[0].assistant_role).toBeNull();
    expect(classifyCandidateRow(rows[0])).toEqual({ verdict: 'no_history' });
  });
});
