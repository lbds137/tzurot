/**
 * Tests for GET /internal/personality/load
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { PersonalityService } from '@tzurot/identity';
import { handleLoadPersonalityInternal } from './personalityLoad.js';
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

const MOCK_PERSONALITY = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Lila',
  displayName: 'Lila',
  slug: 'lila',
  ownerId: '550e8400-e29b-41d4-a716-446655440002',
  systemPrompt: 'You are Lila.',
  model: 'anthropic/claude-sonnet-4.6',
  provider: 'openrouter',
  temperature: 1,
  contextWindowTokens: 200000,
  characterInfo: 'info',
  personalityTraits: 'traits',
  voiceEnabled: false,
};

describe('GET /internal/personality/load', () => {
  let app: express.Express;
  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadSpy = vi.spyOn(PersonalityService.prototype, 'loadPersonality').mockResolvedValue(null);
    app = express();
    app.get(
      '/internal/personality/load',
      handleLoadPersonalityInternal({
        prisma: {} as unknown as PrismaClient,
        ...stubRouteResolvers(),
      })
    );
  });

  it('returns the personality and forwards the userId access-control filter', async () => {
    loadSpy.mockResolvedValue(MOCK_PERSONALITY as never);

    const response = await request(app)
      .get('/internal/personality/load')
      .query({ nameOrId: 'lila', userId: '123456789012345678' });

    expect(response.status).toBe(200);
    expect(response.body.personality).toMatchObject({ id: MOCK_PERSONALITY.id, slug: 'lila' });
    expect(loadSpy).toHaveBeenCalledWith('lila', '123456789012345678');
  });

  it('returns 200 with null personality on a miss (not a 404 — misses are routine)', async () => {
    const response = await request(app)
      .get('/internal/personality/load')
      .query({ nameOrId: 'not-a-personality' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ personality: null });
    expect(loadSpy).toHaveBeenCalledWith('not-a-personality', undefined);
  });

  it('rejects a missing nameOrId with 400', async () => {
    const response = await request(app).get('/internal/personality/load');

    expect(response.status).toBe(400);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty nameOrId with 400', async () => {
    const response = await request(app).get('/internal/personality/load').query({ nameOrId: '' });

    expect(response.status).toBe(400);
  });
});
