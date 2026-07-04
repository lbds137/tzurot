/**
 * Tests for POST /internal/conversation/user-message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { handlePersistUserMessage } from './conversationUserMessage.js';

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
  content: 'Hello bot!\n\n[Image: cat.png]',
  discordMessageId: '111111111111111111',
  messageMetadata: {
    referencedMessages: [
      {
        discordMessageId: '222222222222222222',
        authorUsername: 'other',
        authorDisplayName: 'Other User',
        content: 'referenced text',
        timestamp: '2026-06-04T11:59:00.000Z',
        locationContext: 'same-channel',
      },
    ],
  },
  messageTime: '2026-06-04T12:00:00.000Z',
};

// The id the handler must derive: same generator, createdAt = messageTime.
const EXPECTED_ID = generateConversationHistoryUuid(
  VALID_BODY.channelId,
  VALID_BODY.personalityId,
  VALID_BODY.personaId,
  new Date(VALID_BODY.messageTime)
);

describe('POST /internal/conversation/user-message', () => {
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
      '/internal/conversation/user-message',
      handlePersistUserMessage({ prisma: mockPrisma as unknown as PrismaClient })
    );
  });

  it('creates the row with the deterministic id, message timestamp, and metadata', async () => {
    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: true });

    const createCall = mockPrisma.conversationHistory.create.mock.calls[0][0];
    expect(createCall.data.id).toBe(EXPECTED_ID);
    expect(createCall.data.role).toBe(MessageRole.User);
    expect(createCall.data.discordMessageId).toEqual([VALID_BODY.discordMessageId]);
    expect(createCall.data.createdAt).toEqual(new Date(VALID_BODY.messageTime));
    expect(createCall.data.messageMetadata.referencedMessages).toHaveLength(1);
    expect(createCall.data.tokenCount).toBeGreaterThan(0);
  });

  it('accepts a metadata-free request (plain text message)', async () => {
    const { messageMetadata: _omitted, ...bare } = VALID_BODY;

    const response = await request(app).post('/internal/conversation/user-message').send(bare);

    expect(response.status).toBe(200);
    expect(response.body.created).toBe(true);
  });

  it('reports matched=true without writing when an identical row exists (dual-write)', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: VALID_BODY.content,
      discordMessageId: [VALID_BODY.discordMessageId],
    });

    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: true });
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('reports matched=false when the existing row diverges (burn-in signal)', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValue({
      content: 'different content',
      discordMessageId: [VALID_BODY.discordMessageId],
    });

    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: false });
  });

  it('recovers from a create race by comparing against the winner', async () => {
    mockPrisma.conversationHistory.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      content: VALID_BODY.content,
      discordMessageId: [VALID_BODY.discordMessageId],
    });
    mockPrisma.conversationHistory.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );

    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: EXPECTED_ID, created: false, matched: true });
  });

  it('surfaces non-P2002 create failures as 500', async () => {
    mockPrisma.conversationHistory.create.mockRejectedValue(
      Object.assign(new Error('FK violation'), { code: 'P2003' })
    );

    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send(VALID_BODY);

    expect(response.status).toBe(500);
    expect(mockPrisma.conversationHistory.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects empty content with 400', async () => {
    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send({ ...VALID_BODY, content: '' });

    expect(response.status).toBe(400);
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('rejects a non-snowflake discordMessageId with 400', async () => {
    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send({ ...VALID_BODY, discordMessageId: 'nope' });

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
      '/internal/conversation/user-message',
      handlePersistUserMessage({
        prisma: mockPrisma as unknown as PrismaClient,
        fastPrisma: fast as unknown as PrismaClient,
      })
    );

    await request(fastApp).post('/internal/conversation/user-message').send(VALID_BODY);

    expect(fast.conversationHistory.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.conversationHistory.create).not.toHaveBeenCalled();
  });

  it('self-labels a fast-pool statement_timeout in the logs (the prod diagnostic)', async () => {
    mockPrisma.conversationHistory.create.mockRejectedValue(
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    );

    const response = await request(app)
      .post('/internal/conversation/user-message')
      .send(VALID_BODY);

    expect(response.status).toBe(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'statement-timeout', sqlstate: '57014' }),
      expect.stringContaining('DB timeout')
    );
  });
});
