/**
 * Tests for Voice Management Routes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVoicesRoutes } from './voices.js';
import type { PrismaClient } from '@tzurot/common-types';

// Mock common-types
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

// Mock auth middleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (req: any, _res: any, next: any) => {
    req.userId = 'discord-user-123';
    next();
  },
  requireProvisionedUser: () => (_req: any, _res: any, next: any) => {
    next();
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { decryptApiKey } from '@tzurot/common-types';

describe('Voice Management Routes', () => {
  let app: express.Express;

  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;

  const mockVoicesResponse = {
    voices: [
      { voice_id: 'voice-1', name: 'tzurot-alice', category: 'cloned' },
      { voice_id: 'voice-2', name: 'tzurot-bob', category: 'cloned' },
      { voice_id: 'voice-3', name: 'my-custom-voice', category: 'cloned' },
      { voice_id: 'voice-4', name: 'premade-voice', category: 'premade' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/voices', createVoicesRoutes(mockPrisma));

    // Default: user exists and has encrypted ElevenLabs key (single query with include)
    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid-123',
      apiKeys: [{ iv: 'mock-iv', content: 'mock-content', tag: 'mock-tag' }],
    });

    // Default: decryptApiKey returns test key (must re-apply after restoreAllMocks)
    vi.mocked(decryptApiKey).mockReturnValue('test-elevenlabs-key');

    // Default: ElevenLabs returns voices
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockVoicesResponse),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET / - List voices', () => {
    it('should return tzurot-prefixed voices only', async () => {
      const res = await request(app).get('/voices');

      expect(res.status).toBe(200);
      expect(res.body.voices).toHaveLength(2);
      expect(res.body.voices[0]).toEqual({
        voiceId: 'voice-1',
        name: 'tzurot-alice',
        slug: 'alice',
      });
      expect(res.body.voices[1]).toEqual({
        voiceId: 'voice-2',
        name: 'tzurot-bob',
        slug: 'bob',
      });
      expect(res.body.totalVoices).toBe(4);
      expect(res.body.tzurotCount).toBe(2);
    });

    it('should return 404 when user has no ElevenLabs key', async () => {
      (mockPrisma.user.findFirst as any).mockResolvedValue({
        id: 'user-uuid-123',
        apiKeys: [],
      });

      const res = await request(app).get('/voices');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.message).toContain('ElevenLabs API key');
    });

    it('should return 404 when user does not exist', async () => {
      (mockPrisma.user.findFirst as any).mockResolvedValue(null);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('should return 500 when decryption fails', async () => {
      vi.mocked(decryptApiKey).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const res = await request(app).get('/voices');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('INTERNAL_ERROR');
    });

    it('should return 403 when ElevenLabs rejects the API key', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const res = await request(app).get('/voices');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UNAUTHORIZED');
      expect(res.body.message).toContain('invalid or expired');
    });

    it('should return 500 for non-auth ElevenLabs API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      });

      const res = await request(app).get('/voices');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('INTERNAL_ERROR');
    });

    it('should return 500 when ElevenLabs returns malformed response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: 'format' }),
      });

      const res = await request(app).get('/voices');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('INTERNAL_ERROR');
      expect(res.body.message).toContain('Unexpected response');
    });
  });

  describe('DELETE /:voiceId - Delete a voice', () => {
    it('should delete a tzurot-prefixed voice', async () => {
      // First call: fetch single voice to verify; Second call: delete
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ voice_id: 'voice-1', name: 'tzurot-alice', category: 'cloned' }),
        })
        .mockResolvedValueOnce({ ok: true });

      const res = await request(app).delete('/voices/voice-1');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
      expect(res.body.voiceId).toBe('voice-1');
      expect(res.body.slug).toBe('alice');
    });

    it('should reject deleting a non-tzurot voice (IDOR guard)', async () => {
      // voice-3 is 'my-custom-voice' — not tzurot-prefixed, so ownership check rejects
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ voice_id: 'voice-3', name: 'my-custom-voice', category: 'cloned' }),
      });

      const res = await request(app).delete('/voices/voice-3');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.message).toBe('Tzurot-cloned voice not found');
    });

    it('should reject malformed voiceId without calling ElevenLabs', async () => {
      // URL-encode to ensure the full string reaches the route param
      const badId = 'invalid%20voice%21%23id';
      const res = await request(app).delete(`/voices/${badId}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toBe('Invalid voice ID format');
      // Should not make any ElevenLabs API calls for obviously invalid IDs
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject deleting a nonexistent voice', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const res = await request(app).delete('/voices/nonexistent');

      expect(res.status).toBe(404);
    });

    it('should return 403 when ElevenLabs rejects key during ownership check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const res = await request(app).delete('/voices/voice-1');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UNAUTHORIZED');
      expect(res.body.message).toContain('invalid or expired');
    });

    it('should handle ElevenLabs delete failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ voice_id: 'voice-1', name: 'tzurot-alice', category: 'cloned' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

      const res = await request(app).delete('/voices/voice-1');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('INTERNAL_ERROR');
      expect(res.body.message).toBe('Failed to delete voice');
    });
  });

  describe('POST /clear - Clear all tzurot voices', () => {
    it('should delete all tzurot-prefixed voices', async () => {
      // First call: fetch voices; subsequent calls: delete each
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockVoicesResponse),
        })
        .mockResolvedValue({ ok: true });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);
      expect(res.body.total).toBe(2);
      expect(res.body.errors).toBeUndefined();
    });

    it('should report when no voices to clear', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            voices: [{ voice_id: 'v1', name: 'non-tzurot', category: 'premade' }],
          }),
      });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(0);
      expect(res.body.total).toBe(0);
      expect(res.body.message).toContain('No Tzurot voices');
    });

    it('should return 403 when ElevenLabs rejects key during voice listing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('UNAUTHORIZED');
      expect(res.body.message).toContain('invalid or expired');
    });

    it('should report partial failures', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockVoicesResponse),
        })
        .mockResolvedValueOnce({ ok: true }) // voice-1 succeeds
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' }); // voice-2 fails

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(1);
      expect(res.body.total).toBe(2);
      expect(res.body.errors).toHaveLength(1);
    });

    it('should show actionable message for rate-limited deletions', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockVoicesResponse),
        })
        .mockResolvedValueOnce({ ok: true }) // voice-1 succeeds
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' }); // voice-2 rate limited

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0]).toContain('rate limited');
      expect(res.body.errors[0]).toContain('try again shortly');
    });
  });
});
