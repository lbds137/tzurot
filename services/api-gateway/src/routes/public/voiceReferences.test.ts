/**
 * Voice Reference Route Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';

vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  CACHE_CONTROL: {
    VOICE_REFERENCE_MAX_AGE: 3600,
  },
  VOICE_REFERENCE_LIMITS: {
    ALLOWED_TYPES: ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac'],
  },
}));

vi.mock('../../utils/errorResponses.js', () => ({
  ErrorResponses: {
    validationError: vi.fn((message: string) => ({ error: 'Validation Error', message })),
    notFound: vi.fn((resource: string) => ({
      error: 'Not Found',
      message: `${resource} not found`,
    })),
    internalError: vi.fn((message: string) => ({ error: 'Internal Error', message })),
  },
}));

vi.mock('../../utils/validators.js', () => ({
  validateSlug: vi.fn((slug: string | undefined) => {
    if (!slug || slug.length > 64 || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return { valid: false, error: { error: 'Validation Error', message: 'Invalid slug' } };
    }
    return { valid: true };
  }),
}));

import { createVoiceReferenceRouter } from './voiceReferences.js';

function createMockPrisma() {
  return {
    personality: {
      findUnique: vi.fn(),
    },
  };
}

describe('Voice Reference Routes', () => {
  let app: express.Express;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = express();
    app.use('/voice-references', createVoiceReferenceRouter(mockPrisma as never));
  });

  describe('GET /:slug', () => {
    it('should reject slug with special characters', async () => {
      const response = await request(app).get('/voice-references/test<script>');

      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject slug with uppercase letters', async () => {
      const response = await request(app).get('/voice-references/TestBot');

      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject slug with underscores', async () => {
      const response = await request(app).get('/voice-references/test_bot');

      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should return 404 when personality has no voice reference', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        voiceReferenceData: null,
        voiceReferenceType: null,
      });

      const response = await request(app).get('/voice-references/testbot');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
      expect(response.body.error).toBe('Not Found');
    });

    it('should return 404 when personality does not exist', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/voice-references/nonexistent');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should serve voice reference with correct content type', async () => {
      const audioBuffer = Buffer.from('fake-wav-data');
      mockPrisma.personality.findUnique.mockResolvedValue({
        voiceReferenceData: audioBuffer,
        voiceReferenceType: 'audio/wav',
      });

      const response = await request(app).get('/voice-references/testbot');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.headers['content-type']).toContain('audio/wav');
      expect(response.headers['cache-control']).toContain('max-age=3600');
      expect(response.body).toEqual(audioBuffer);
    });

    it('should default to audio/wav when voiceReferenceType is null', async () => {
      const audioBuffer = Buffer.from('fake-audio');
      mockPrisma.personality.findUnique.mockResolvedValue({
        voiceReferenceData: audioBuffer,
        voiceReferenceType: null,
      });

      const response = await request(app).get('/voice-references/testbot');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.headers['content-type']).toContain('audio/wav');
    });

    it('should fall back to audio/wav for unexpected stored MIME type', async () => {
      const audioBuffer = Buffer.from('fake-audio');
      mockPrisma.personality.findUnique.mockResolvedValue({
        voiceReferenceData: audioBuffer,
        voiceReferenceType: 'text/html',
      });

      const response = await request(app).get('/voice-references/testbot');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.headers['content-type']).toContain('audio/wav');
    });

    it('should handle database error gracefully', async () => {
      mockPrisma.personality.findUnique.mockRejectedValue(new Error('DB down'));

      const response = await request(app).get('/voice-references/testbot');

      expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(response.body.error).toBe('Internal Error');
    });

    it('should query with correct select fields', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      await request(app).get('/voice-references/my-persona');

      expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
        where: { slug: 'my-persona' },
        select: { voiceReferenceData: true, voiceReferenceType: true },
      });
    });
  });
});
