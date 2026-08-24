/**
 * Tests for POST /internal/telemetry/command-event
 *
 * The load-bearing case here is the allowlist strip: telemetry must be unable
 * to carry message content even if a caller sends it, so the smuggled-key test
 * is the drift guard this route exists to provide.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleRecordCommandEvent, TELEMETRY_CONTEXT_ALLOWLIST } from './telemetryCommandEvent.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

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

const VALID_USER_ID = '123456789012345678';
const VALID_GUILD_ID = '987654321098765432';
const VALID_CHARACTER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const ROUTE = '/internal/telemetry/command-event';

/** A minimal valid body; individual tests override the fields they exercise. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: VALID_USER_ID,
    channelKind: 'guild',
    command: 'character.create',
    outcome: 'ok',
    latencyMs: 42,
    ...overrides,
  };
}

describe('POST /api/internal/telemetry/command-event', () => {
  let mockPrisma: { commandEvent: { create: ReturnType<typeof vi.fn> } };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = { commandEvent: { create: vi.fn().mockResolvedValue({ id: 'row-1' }) } };
    app = express();
    app.use(express.json());
    app.post(
      ROUTE,
      handleRecordCommandEvent({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );
  });

  /** The `data` object that crossed the Prisma seam on the first create call. */
  function createdData(): Record<string, unknown> {
    const call = mockPrisma.commandEvent.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return call[0].data;
  }

  it('writes one row with every field forwarded verbatim', async () => {
    const response = await request(app)
      .post(ROUTE)
      .send(
        validBody({
          guildId: VALID_GUILD_ID,
          channelKind: 'thread',
          characterId: VALID_CHARACTER_ID,
          outcome: 'user_error',
          errorCode: 'ValidationError',
          latencyMs: 1234,
        })
      );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ recorded: true });
    expect(mockPrisma.commandEvent.create).toHaveBeenCalledTimes(1);
    expect(createdData()).toEqual({
      userId: VALID_USER_ID,
      guildId: VALID_GUILD_ID,
      channelKind: 'thread',
      command: 'character.create',
      characterId: VALID_CHARACTER_ID,
      outcome: 'user_error',
      errorCode: 'ValidationError',
      latencyMs: 1234,
      context: undefined,
    });
  });

  it('stores SQL NULL for every omitted optional field', async () => {
    const response = await request(app).post(ROUTE).send(validBody());

    expect(response.status).toBe(200);
    expect(createdData()).toMatchObject({
      guildId: null,
      characterId: null,
      errorCode: null,
      context: undefined,
    });
  });

  describe('context allowlist (the drift guard)', () => {
    it('strips a smuggled content key and keeps only the allowlisted one', async () => {
      const response = await request(app)
        .post(ROUTE)
        .send(
          validBody({
            context: {
              model_family: 'claude',
              message_content: 'the user said something private',
              prompt: 'and here is the whole prompt',
            },
          })
        );

      expect(response.status).toBe(200);
      // The whole point: the row carries the allowlisted key and NOTHING else.
      expect(createdData().context).toEqual({ model_family: 'claude' });
    });

    it('keeps every allowlisted key', async () => {
      const context = Object.fromEntries(
        TELEMETRY_CONTEXT_ALLOWLIST.map(key => [key, `value-for-${key}`])
      );

      await request(app).post(ROUTE).send(validBody({ context }));

      expect(createdData().context).toEqual(context);
    });

    it('stores NULL rather than {} when every key is stripped', async () => {
      await request(app)
        .post(ROUTE)
        .send(validBody({ context: { message_content: 'nope', user_email: 'nope' } }));

      expect(createdData().context).toBeUndefined();
    });
  });

  describe('validation', () => {
    it.each([
      ['a non-snowflake userId', { userId: 'not-a-snowflake' }],
      ['a non-snowflake guildId', { guildId: 'not-a-snowflake' }],
      ['an unknown channelKind', { channelKind: 'voice' }],
      ['an unknown outcome', { outcome: 'exploded' }],
      ['an empty command', { command: '' }],
      ['an over-long command', { command: 'x'.repeat(101) }],
      ['an over-long errorCode', { errorCode: 'x'.repeat(101) }],
      ['a non-uuid characterId', { characterId: 'not-a-uuid' }],
      ['a negative latencyMs', { latencyMs: -1 }],
      ['a fractional latencyMs', { latencyMs: 1.5 }],
    ])('rejects %s without writing a row', async (_label, overrides) => {
      const response = await request(app).post(ROUTE).send(validBody(overrides));

      expect(response.status).toBe(400);
      expect(mockPrisma.commandEvent.create).not.toHaveBeenCalled();
    });

    it('rejects a body missing the required fields', async () => {
      const response = await request(app).post(ROUTE).send({});

      expect(response.status).toBe(400);
      expect(mockPrisma.commandEvent.create).not.toHaveBeenCalled();
    });
  });

  it('reports a failed insert as a 500 rather than a silent success', async () => {
    mockPrisma.commandEvent.create.mockRejectedValue(new Error('db down'));

    const response = await request(app).post(ROUTE).send(validBody());

    expect(response.status).toBe(500);
  });
});
