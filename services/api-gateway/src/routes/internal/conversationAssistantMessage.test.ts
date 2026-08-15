/**
 * Tests for POST /internal/conversation/assistant-message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { type ConversationHistoryClient } from '@tzurot/conversation-history';
import { handlePersistAssistantMessage } from './conversationAssistantMessage.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const VALID_BODY = {
  channelId: '123456789012345678',
  guildId: '876543210987654321',
  personalityId: '550e8400-e29b-41d4-a716-446655440000',
  personaId: '550e8400-e29b-41d4-a716-446655440001',
  content: 'Hello from the assistant.',
  chunkMessageIds: ['111111111111111111', '222222222222222222'],
  userMessageTime: '2026-06-04T12:00:00.000Z',
};

// The id the handler must derive: same generator, assistant time = user + 1ms.
const EXPECTED_ID = generateConversationHistoryUuid(
  VALID_BODY.channelId,
  VALID_BODY.personalityId,
  VALID_BODY.personaId,
  new Date('2026-06-04T12:00:00.001Z')
);

describe('POST /api/internal/conversation/assistant-message', () => {
  let mockPrisma: {
    conversationHistory: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      conversationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    app = express();
    app.use(express.json());
    app.post(
      '/internal/conversation/assistant-message',
      handlePersistAssistantMessage({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );
  });

  it('creates the row with the deterministic id and +1ms assistant timestamp', async () => {
    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: true });

    const createCall = mockPrisma.conversationHistory.create.mock.calls[0][0];
    expect(createCall.data.id).toBe(EXPECTED_ID);
    expect(createCall.data.role).toBe(MessageRole.Assistant);
    expect(createCall.data.discordMessageId).toEqual(VALID_BODY.chunkMessageIds);
    expect(createCall.data.createdAt).toEqual(new Date('2026-06-04T12:00:00.001Z'));
    expect(createCall.data.guildId).toBe(VALID_BODY.guildId);
    expect(createCall.data.tokenCount).toBeGreaterThan(0);
  });

  it('reports matched=true without writing when an identical row exists (idempotent replay)', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: VALID_BODY.content,
      discordMessageId: VALID_BODY.chunkMessageIds,
    });

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: true });
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('reports matched=false when the existing row diverges (replay drift signal)', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: 'different content',
      discordMessageId: VALID_BODY.chunkMessageIds,
    });

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: false });
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('warns when a replay carries a different trace, without failing the match', async () => {
    // The benign-looking shape that silently loses data: everything matches, so
    // the replay is correctly `matched: true` — but the column is write-once, so
    // the incoming trace is discarded. Without the warn there is no signal at
    // all that a trace existed and was dropped.
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: VALID_BODY.content,
      discordMessageId: VALID_BODY.chunkMessageIds,
      thinkingContent: null,
    });

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send({ ...VALID_BODY, thinkingContent: 'a trace the first attempt never captured' });

    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storedWasNull: true, incomingLength: 40 }),
      expect.stringContaining('different reasoning trace')
    );
  });

  it('stays silent when an empty replay trace meets an already-null stored row', async () => {
    // Both mean "no trace" — the write path stores '' as null, so comparing the
    // RAW incoming value against the normalized stored one would report drift
    // between two identical meanings and make the warn untrustworthy.
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: VALID_BODY.content,
      discordMessageId: VALID_BODY.chunkMessageIds,
      thinkingContent: null,
    });

    await request(app)
      .post('/internal/conversation/assistant-message')
      .send({ ...VALID_BODY, thinkingContent: '' });

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('stays silent when the replay carries the same trace as the stored row', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: VALID_BODY.content,
      discordMessageId: VALID_BODY.chunkMessageIds,
      thinkingContent: 'identical trace',
    });

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send({ ...VALID_BODY, thinkingContent: 'identical trace' });

    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: true });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('reports matched=false when chunk IDs differ in order', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: VALID_BODY.content,
      discordMessageId: [...VALID_BODY.chunkMessageIds].reverse(),
    });

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: false });
  });

  it('recovers from a create race by comparing against the winner', async () => {
    // findUnique misses, create hits the unique violation (legacy writer won
    // the race), the re-read finds the identical row.
    mockPrisma.conversationHistory.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      content: VALID_BODY.content,
      discordMessageId: VALID_BODY.chunkMessageIds,
    });
    mockPrisma.conversationHistory.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: true });
  });

  it('surfaces non-P2002 create failures as 500 even when a row appears concurrently', async () => {
    // A non-unique-violation failure (FK violation, transient DB error) must
    // NOT be masked by the compare fallback, even if a legacy-writer row
    // lands in the same window.
    mockPrisma.conversationHistory.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      content: VALID_BODY.content,
      discordMessageId: VALID_BODY.chunkMessageIds,
    });
    mockPrisma.conversationHistory.create.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' })
    );

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(500);
    // The compare fallback never ran — only the pre-create existence check.
    expect(mockPrisma.conversationHistory.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects empty chunkMessageIds with 400', async () => {
    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send({ ...VALID_BODY, chunkMessageIds: [] });

    expect(response.status).toBe(400);
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('rejects non-ISO userMessageTime with 400', async () => {
    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send({ ...VALID_BODY, userMessageTime: 'yesterday' });

    expect(response.status).toBe(400);
  });

  it('routes the persist through fastPrisma when one is provided', async () => {
    const fast = {
      conversationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const fastApp = express();
    fastApp.use(express.json());
    fastApp.post(
      '/internal/conversation/assistant-message',
      handlePersistAssistantMessage({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        fastPrisma: fast as unknown as ConversationHistoryClient,
      })
    );

    await request(fastApp).post('/internal/conversation/assistant-message').send(VALID_BODY);

    expect(fast.conversationHistory.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('self-labels a fast-pool lock_timeout in the logs (the prod diagnostic)', async () => {
    mockPrisma.conversationHistory.create.mockRejectedValue(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    );

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'lock-timeout', sqlstate: '55P03' }),
      expect.stringContaining('DB timeout')
    );
  });

  it('self-labels a fast-pool timeout on the existence-check read (symmetric with the write path)', async () => {
    mockPrisma.conversationHistory.findUnique.mockRejectedValue(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    );

    const response = await request(app)
      .post('/internal/conversation/assistant-message')
      .send(VALID_BODY);

    expect(response.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'lock-timeout', sqlstate: '55P03', id: EXPECTED_ID }),
      'Assistant-message existence check hit a fast-pool DB timeout'
    );
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });
});
