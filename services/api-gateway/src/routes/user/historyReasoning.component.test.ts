/**
 * Component test: reasoning-trace persistence and read-back over REAL PGLite.
 *
 * This is the SEQUENCING test for the trace's write→read chain (rule 7). Every
 * unit suite along that chain mocks its neighbour, so none of them can observe
 * that the trace bot-client sends actually lands in the column the command
 * later reads. Here the real persist handler (including its Zod parse), the
 * real ConversationHistoryService, the real column, and the real reasoning
 * handler run in order against a real database.
 *
 * It is also where the access gate is pinned. The gate lives in the handler's
 * WHERE clause, so a mocked prisma would assert only that we passed some
 * filter object — not that the filter actually excludes another user's row.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import type { AuthenticatedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const OWNER_USER = '7c3e1f77-0000-4000-8000-00000000e001';
const OWNER_PERSONA = '7c3e1f77-0000-4000-8000-00000000e002';
const PERSONALITY = '7c3e1f77-0000-4000-8000-00000000e003';
const SYSTEM_PROMPT = '7c3e1f77-0000-4000-8000-00000000e004';
const OTHER_USER = '7c3e1f77-0000-4000-8000-00000000e005';
const OTHER_PERSONA = '7c3e1f77-0000-4000-8000-00000000e006';

const OWNER_DISCORD = '900000000000000071';
const OTHER_DISCORD = '900000000000000072';
const BOT_OWNER_DISCORD = '900000000000000099';

const CHANNEL = '123456789012345678';
const CHUNK_ID = '222222222222222222';
/** The user's own message id — the OTHER thing a right-click can target. */
const TRIGGER_ID = '333333333333333333';
const USER_ROW_ID = '7c3e1f77-0000-4000-8000-00000000e007';
const USER_MESSAGE_TIME = '2026-06-04T12:00:00.000Z';

/** The value whose survival across the whole chain is the point of this file. */
const SENTINEL_TRACE = 'SENTINEL-TRACE-9f8e7d: I weighed two castle metaphors and picked one.';

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

import { handlePersistAssistantMessage } from '../internal/conversationAssistantMessage.js';
import { handleGetMessageReasoning } from './historyReasoning.js';

describe('reasoning trace persistence + read-back (component, PGLite)', () => {
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
      username: 'traceuser',
      personaName: 'Trace Persona',
      personaPreferredName: 'Tracer',
      personaContent: 'The tracing persona',
    });
    await seedUserWithPersona(prisma, {
      userId: OTHER_USER,
      personaId: OTHER_PERSONA,
      discordId: OTHER_DISCORD,
      username: 'otheruser',
      personaName: 'Other Persona',
      personaPreferredName: 'Otherer',
      personaContent: 'A different persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'T Prompt', 'You are a trace bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'TBot', 'T Bot', 'tbot', ${SYSTEM_PROMPT}::uuid, 'T character', 'Thoughtful', ${OWNER_USER}::uuid, NOW())
    `;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM conversation_history`;
    mockIsBotOwner.mockReturnValue(false);
  });

  function deps(): RouteDeps {
    return { prisma } as unknown as RouteDeps;
  }

  function reqRes(overrides: {
    userId?: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
  }) {
    const req = {
      userId: overrides.userId,
      params: overrides.params ?? {},
      body: overrides.body ?? {},
      query: {},
    } as unknown as AuthenticatedRequest;
    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    return { req, res, json, status };
  }

  /** Drive the REAL persist route, exactly as bot-client's POST would. */
  async function persistAssistantTurn(thinkingContent?: string): Promise<void> {
    const { req, res } = reqRes({
      body: {
        channelId: CHANNEL,
        guildId: null,
        personalityId: PERSONALITY,
        personaId: OWNER_PERSONA,
        content: 'A castle is a fortified residence.',
        chunkMessageIds: [CHUNK_ID],
        userMessageTime: USER_MESSAGE_TIME,
        ...(thinkingContent !== undefined && { thinkingContent }),
      },
    });
    await handlePersistAssistantMessage(deps())(req, res, () => undefined);
  }

  it('carries the trace from the POST body into the column, then back out to the reader', async () => {
    await persistAssistantTurn(SENTINEL_TRACE);

    // The column itself — read raw, so no service-layer mapping can launder a
    // wrong value into looking right.
    const rows = await prisma.$queryRaw<{ thinking_content: string | null }[]>`
      SELECT thinking_content FROM conversation_history WHERE ${CHUNK_ID} = ANY(discord_message_id)
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].thinking_content).toBe(SENTINEL_TRACE);

    // ...and the read handler returns that same value to the owning user.
    const { req, res, json } = reqRes({
      userId: OWNER_DISCORD,
      params: { messageId: CHUNK_ID },
    });
    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ thinkingContent: SENTINEL_TRACE }));
  });

  it('stores null when the model produced no trace', async () => {
    await persistAssistantTurn();

    const { req, res, json } = reqRes({
      userId: OWNER_DISCORD,
      params: { messageId: CHUNK_ID },
    });
    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    // 200-with-null, NOT a 404: the turn exists, it simply has no reasoning.
    // The command renders different copy for each, so the distinction matters.
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ thinkingContent: null }));
  });

  it("404s another user's row instead of leaking the trace", async () => {
    await persistAssistantTurn(SENTINEL_TRACE);

    const { req, res, json, status } = reqRes({
      userId: OTHER_DISCORD,
      params: { messageId: CHUNK_ID },
    });
    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(status).toHaveBeenCalledWith(404);
    // The trace must appear nowhere in the response — not in an error body,
    // not in a partial payload.
    expect(JSON.stringify(json.mock.calls)).not.toContain(SENTINEL_TRACE);
  });

  it('lets the bot owner read a row they do not own', async () => {
    await persistAssistantTurn(SENTINEL_TRACE);
    mockIsBotOwner.mockReturnValue(true);

    const { req, res, json } = reqRes({
      userId: BOT_OWNER_DISCORD,
      params: { messageId: CHUNK_ID },
    });
    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ thinkingContent: SENTINEL_TRACE }));
  });

  it('500s rather than reading unfiltered when the caller identity is missing', async () => {
    await persistAssistantTurn(SENTINEL_TRACE);

    const { req, res, json, status } = reqRes({
      userId: undefined,
      params: { messageId: CHUNK_ID },
    });
    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls)).not.toContain(SENTINEL_TRACE);
  });

  it('does not resolve a soft-deleted turn', async () => {
    await persistAssistantTurn(SENTINEL_TRACE);
    await prisma.$executeRaw`UPDATE conversation_history SET deleted_at = NOW()`;

    const { req, res, status } = reqRes({
      userId: OWNER_DISCORD,
      params: { messageId: CHUNK_ID },
    });
    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(status).toHaveBeenCalledWith(404);
  });

  /**
   * The trigger-message bridge. Tier 1 (the diagnostic lookup this falls back
   * FROM) resolves EITHER click target via its by-message → by-response
   * fallback, so tier 2 has to as well — otherwise the command silently stops
   * answering for one of two inputs at exactly the 24h boundary this column
   * exists to cover.
   */
  describe('trigger-message bridge', () => {
    /** The user's own turn — a separate row with its own Discord id. */
    async function persistUserTurn(personaId = OWNER_PERSONA): Promise<void> {
      await prisma.conversationHistory.create({
        data: {
          // Deterministic in prod (generateConversationHistoryUuid); a literal
          // is enough here — the bridge keys on role + timestamp, not on id.
          id: USER_ROW_ID,
          channelId: CHANNEL,
          personalityId: PERSONALITY,
          personaId,
          role: 'user',
          content: 'What is a castle?',
          discordMessageId: [TRIGGER_ID],
          // Strictly BEFORE the assistant row, which persists at +1ms.
          createdAt: new Date(USER_MESSAGE_TIME),
        },
      });
    }

    it("resolves the reply's trace when the user right-clicks their OWN message", async () => {
      await persistUserTurn();
      await persistAssistantTurn(SENTINEL_TRACE);

      const { req, res, json } = reqRes({
        userId: OWNER_DISCORD,
        params: { messageId: TRIGGER_ID },
      });
      await handleGetMessageReasoning(deps())(req, res, () => undefined);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingContent: SENTINEL_TRACE })
      );
    });

    it("404s another user's trigger message instead of bridging to the trace", async () => {
      await persistUserTurn();
      await persistAssistantTurn(SENTINEL_TRACE);

      const { req, res, json, status } = reqRes({
        userId: OTHER_DISCORD,
        params: { messageId: TRIGGER_ID },
      });
      await handleGetMessageReasoning(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(404);
      // The bridge adds a SECOND query path to the trace; the gate has to hold
      // on both hops, not just the direct one.
      expect(JSON.stringify(json.mock.calls)).not.toContain(SENTINEL_TRACE);
    });

    it("does not attribute a LATER turn's trace when the paired reply is missing", async () => {
      // Reachable, not hypothetical: SlotDeliveryService persists AFTER the
      // webhook send and deliberately swallows failures, so a reply the user
      // can see may have no row. A range scan would answer this click with the
      // next unrelated turn's reasoning; the exact pairing answers with nothing.
      await persistUserTurn();
      // No reply for THAT trigger — instead, a later unrelated assistant turn
      // in the same channel/personality/persona.
      await prisma.conversationHistory.create({
        data: {
          id: '7c3e1f77-0000-4000-8000-00000000e008',
          channelId: CHANNEL,
          personalityId: PERSONALITY,
          personaId: OWNER_PERSONA,
          role: 'assistant',
          content: 'A reply to something else entirely.',
          discordMessageId: ['444444444444444444'],
          thinkingContent: 'UNRELATED-TRACE: this belongs to a different turn',
          createdAt: new Date(new Date(USER_MESSAGE_TIME).getTime() + 60_000),
        },
      });

      const { req, res, json, status } = reqRes({
        userId: OWNER_DISCORD,
        params: { messageId: TRIGGER_ID },
      });
      await handleGetMessageReasoning(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(404);
      expect(JSON.stringify(json.mock.calls)).not.toContain('UNRELATED-TRACE');
    });

    it('404s when the trigger has no reply persisted yet', async () => {
      await persistUserTurn();

      const { req, res, status } = reqRes({
        userId: OWNER_DISCORD,
        params: { messageId: TRIGGER_ID },
      });
      await handleGetMessageReasoning(deps())(req, res, () => undefined);

      expect(status).toHaveBeenCalledWith(404);
    });
  });
});
