/**
 * Tests for POST /internal/conversation/sync
 *
 * The diff algorithm is tested in common-types (ConversationSyncService).
 * These tests cover the endpoint contract: validation, snapshot mapping,
 * and result pass-through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { ConversationSyncService } from '@tzurot/conversation-history';
import { handleSyncConversation } from './conversationSync.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const VALID_BODY = {
  channelId: '123456789012345678',
  personalityId: '550e8400-e29b-41d4-a716-446655440000',
  observedMessages: [
    {
      discordMessageId: '111111111111111111',
      content: 'observed content',
      createdAt: '2026-06-04T12:00:00.000Z',
    },
  ],
};

describe('POST /internal/conversation/sync', () => {
  let app: express.Express;
  let runSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    runSyncSpy = vi
      .spyOn(ConversationSyncService.prototype, 'runSync')
      .mockResolvedValue({ updated: 0, deleted: 0 });
    app = express();
    app.use(express.json());
    app.post(
      '/internal/conversation/sync',
      handleSyncConversation({ prisma: {} as unknown as PrismaClient })
    );
  });

  it('delegates to runSync with Date-mapped observed messages', async () => {
    const response = await request(app).post('/internal/conversation/sync').send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 0, deleted: 0 });
    expect(runSyncSpy).toHaveBeenCalledWith(VALID_BODY.channelId, VALID_BODY.personalityId, [
      {
        id: '111111111111111111',
        content: 'observed content',
        createdAt: new Date('2026-06-04T12:00:00.000Z'),
      },
    ]);
  });

  it('passes through nonzero sync results', async () => {
    runSyncSpy.mockResolvedValue({ updated: 2, deleted: 1 });

    const response = await request(app).post('/internal/conversation/sync').send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 2, deleted: 1 });
  });

  it('rejects an empty observedMessages array with 400', async () => {
    const response = await request(app)
      .post('/internal/conversation/sync')
      .send({ ...VALID_BODY, observedMessages: [] });

    expect(response.status).toBe(400);
    expect(runSyncSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-snowflake discordMessageId with 400', async () => {
    const response = await request(app)
      .post('/internal/conversation/sync')
      .send({
        ...VALID_BODY,
        observedMessages: [
          { discordMessageId: 'nope', content: 'x', createdAt: '2026-06-04T12:00:00.000Z' },
        ],
      });

    expect(response.status).toBe(400);
    expect(runSyncSpy).not.toHaveBeenCalled();
  });
});
