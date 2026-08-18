/**
 * Tests for POST /internal/conversation/forwarded-origin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { handlePatchForwardedOrigin } from './conversationForwardedOrigin.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

const { mockMergeForwardedOrigin } = vi.hoisted(() => ({
  mockMergeForwardedOrigin: vi.fn(),
}));

vi.mock('@tzurot/conversation-history', () => ({
  mergeForwardedOrigin: mockMergeForwardedOrigin,
}));

const VALID_BODY = {
  channelId: '123456789012345678',
  personalityId: '550e8400-e29b-41d4-a716-446655440000',
  personaId: '550e8400-e29b-41d4-a716-446655440001',
  messageTime: '2026-06-04T12:00:00.000Z',
  forwardedFrom: {
    authorName: 'COLD',
    authorId: '1472768398135001108',
    timestamp: '2026-08-18T11:13:53.053Z',
    authorPersonalityId: '550e8400-e29b-41d4-a716-446655440002',
  },
};

/**
 * The id the handler must derive on its own. Recomputed here from the same
 * generator rather than hardcoded, because the point of the assertion is that
 * this endpoint and the persist endpoint address the SAME row — a literal
 * would still pass if both drifted together.
 */
const EXPECTED_ID = generateConversationHistoryUuid(
  VALID_BODY.channelId,
  VALID_BODY.personalityId,
  VALID_BODY.personaId,
  new Date(VALID_BODY.messageTime)
);

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // stubRouteResolvers() supplies only the resolvers, so prisma is spread in
  // alongside it — omitting it leaves deps.prisma undefined, which the
  // handler passes straight through to the writer.
  const prisma = {} as unknown as PrismaClient;
  app.post('/forwarded-origin', handlePatchForwardedOrigin({ prisma, ...stubRouteResolvers() }));
  return app;
}

describe('POST /internal/conversation/forwarded-origin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives the row id and reports the merge result', async () => {
    mockMergeForwardedOrigin.mockResolvedValueOnce(true);

    const res = await request(buildApp()).post('/forwarded-origin').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: true });
    // The seam that matters: id derivation happens HERE, not in the caller, so
    // this endpoint cannot address a different row than the persist did.
    expect(mockMergeForwardedOrigin).toHaveBeenCalledWith(
      expect.anything(),
      EXPECTED_ID,
      VALID_BODY.forwardedFrom
    );
  });

  it('reports updated:false for a row that does not exist, with a 200', async () => {
    mockMergeForwardedOrigin.mockResolvedValueOnce(false);

    const res = await request(buildApp()).post('/forwarded-origin').send(VALID_BODY);

    // Not a 404: the persist is best-effort bot-side, so a missing row is an
    // ordinary outcome of a fire-and-forget backfill and must not read as a
    // failure the caller should retry or alert on.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: false });
  });

  it('rejects a body whose origin is not an object', async () => {
    const res = await request(buildApp())
      .post('/forwarded-origin')
      .send({ ...VALID_BODY, forwardedFrom: 'COLD' });

    expect(res.status).toBe(400);
    expect(mockMergeForwardedOrigin).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid personalityId before touching the database', async () => {
    const res = await request(buildApp())
      .post('/forwarded-origin')
      .send({ ...VALID_BODY, personalityId: 'not-a-uuid' });

    // The id derivation would otherwise happily hash a garbage value into a
    // well-formed uuid that addresses nothing, and the miss would look
    // identical to an ordinary absent row.
    expect(res.status).toBe(400);
    expect(mockMergeForwardedOrigin).not.toHaveBeenCalled();
  });

  it('accepts an origin carrying only the timestamp', async () => {
    mockMergeForwardedOrigin.mockResolvedValueOnce(true);

    const res = await request(buildApp())
      .post('/forwarded-origin')
      .send({ ...VALID_BODY, forwardedFrom: { timestamp: '2026-08-18T11:13:53.053Z' } });

    // The half-resolved shape a deleted original produces: the snapshot still
    // carried a post time even though the author could not be re-fetched.
    expect(res.status).toBe(200);
    expect(mockMergeForwardedOrigin).toHaveBeenCalledWith(expect.anything(), EXPECTED_ID, {
      timestamp: '2026-08-18T11:13:53.053Z',
    });
  });
});
