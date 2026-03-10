/**
 * Tests for Voice Models Route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import type { PrismaClient } from '@tzurot/common-types';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    decryptApiKey: vi.fn().mockReturnValue('test-elevenlabs-key'),
  };
});

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (req: any, _res: any, next: any) => {
    req.userId = 'discord-user-123';
    next();
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { decryptApiKey } from '@tzurot/common-types';
import { handleListModels } from './voiceModels.js';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../../types.js';

describe('Voice Models Route', () => {
  let app: express.Express;

  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.get(
      '/models',
      requireUserAuth(),
      asyncHandler(async (req: AuthenticatedRequest, res) => {
        await handleListModels(mockPrisma, req, res);
      })
    );

    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid-123',
      apiKeys: [{ iv: 'mock-iv', content: 'mock-content', tag: 'mock-tag' }],
    });

    vi.mocked(decryptApiKey).mockReturnValue('test-elevenlabs-key');
  });

  it('should return TTS-capable models', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            model_id: 'eleven_multilingual_v2',
            name: 'Multilingual v2',
            can_do_text_to_speech: true,
          },
          { model_id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', can_do_text_to_speech: true },
          { model_id: 'scribe_v1', name: 'Scribe v1', can_do_text_to_speech: false },
        ]),
    });

    const response = await request(app).get('/models');

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.body.models).toEqual([
      { modelId: 'eleven_multilingual_v2', name: 'Multilingual v2' },
      { modelId: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
    ]);
  });

  it('should return error when ElevenLabs key is missing', async () => {
    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid-123',
      apiKeys: [],
    });

    const response = await request(app).get('/models');

    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('should return error on ElevenLabs auth failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const response = await request(app).get('/models');

    expect(response.status).toBe(StatusCodes.FORBIDDEN);
  });

  it('should return error on ElevenLabs server error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const response = await request(app).get('/models');

    expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });

  it('should return error on invalid response format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    });

    const response = await request(app).get('/models');

    expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
