/**
 * Tests for POST /internal/v1/routing-context
 *
 * Isolates the HTTP layer: the orchestration (`resolveRoutingContext`) is
 * unit-tested in common-types, so here it's mocked to exercise the parse →
 * resolve → respond wiring plus the bot-author and validation error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

const mockResolveRoutingContext = vi.fn();

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

// Partial-mock identity: stub PersonaResolver (the handler constructs it
// directly) so the factory doesn't start its real cache-cleanup interval, and
// stub resolveRoutingContext to isolate the HTTP layer. UserService is reached
// via getOrCreateUserService (the real AuthMiddleware path), so keep the real
// export by spreading the actual module.
vi.mock('@tzurot/identity', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/identity')>('@tzurot/identity');
  return {
    ...actual,
    PersonaResolver: vi.fn(),
    resolveRoutingContext: (...args: unknown[]) => mockResolveRoutingContext(...args),
  };
});

import { handleRoutingContextCreate } from './routingContextCreate.js';

const VALID_BODY = {
  discordId: '278863839632818186',
  username: 'lila',
  displayName: 'Lila',
  personalityId: '550e8400-e29b-41d4-a716-446655440002',
};

const RESOLVED = {
  userId: '11111111-1111-1111-1111-111111111111',
  personaId: '550e8400-e29b-41d4-a716-446655440003',
  personaName: 'Nyx',
  timezone: 'UTC',
  contextEpoch: '2026-06-20T00:00:00.000Z',
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.post(
    '/internal/v1/routing-context',
    handleRoutingContextCreate({ prisma: {} as unknown as PrismaClient })
  );
  return app;
}

describe('POST /internal/v1/routing-context', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('resolves and returns the routing bundle', async () => {
    mockResolveRoutingContext.mockResolvedValue(RESOLVED);

    const response = await request(buildApp())
      .post('/internal/v1/routing-context')
      .send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject(RESOLVED);
    // The parsed request is forwarded verbatim to the resolver.
    expect(mockResolveRoutingContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discordId: '278863839632818186',
        personalityId: '550e8400-e29b-41d4-a716-446655440002',
      })
    );
  });

  it('returns 400 for a bot author (resolver returns null)', async () => {
    mockResolveRoutingContext.mockResolvedValue(null);

    const response = await request(buildApp())
      .post('/internal/v1/routing-context')
      .send({ ...VALID_BODY, isBot: true });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('returns 400 when the request body is invalid', async () => {
    const response = await request(buildApp())
      .post('/internal/v1/routing-context')
      .send({ discordId: '', username: 'x' }); // missing displayName + personalityId, empty discordId

    expect(response.status).toBe(400);
    expect(mockResolveRoutingContext).not.toHaveBeenCalled();
  });
});
