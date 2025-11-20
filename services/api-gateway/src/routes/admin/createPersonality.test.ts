/**
 * Create Personality Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createCreatePersonalityRoute } from './createPersonality.js';
import type { PrismaClient } from '@prisma/client';

// Mock AuthMiddleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (_req: unknown, _res: unknown, next: () => void) => {
    next(); // Bypass auth for testing
  },
}));

// Mock imageProcessor
vi.mock('../../utils/imageProcessor.js', () => ({
  optimizeAvatar: vi.fn().mockResolvedValue({
    buffer: Buffer.from('optimized-image-data'),
    originalSizeKB: 300,
    processedSizeKB: 150,
    quality: 85,
    exceedsTarget: false,
  }),
}));

// Create mock Prisma client
const createMockPrismaClient = () => ({
  personality: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  llmConfig: {
    findFirst: vi.fn(),
  },
  personalityDefaultConfig: {
    create: vi.fn(),
  },
});

describe('POST /admin/personality', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    prisma = createMockPrismaClient();

    // Create Express app with create personality router
    app = express();
    app.use(express.json());
    app.use('/admin/personality', createCreatePersonalityRoute(prisma as unknown as PrismaClient));
  });

  it('should create a new personality with required fields', async () => {
    prisma.personality.findUnique.mockResolvedValue(null); // Slug doesn't exist
    prisma.personality.create.mockResolvedValue({
      id: 'personality-123',
      name: 'Test Bot',
      slug: 'test-bot',
      displayName: null,
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly and knowledgeable',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      customFields: null,
      avatarData: null,
      voiceEnabled: false,
      imageEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.llmConfig.findFirst.mockResolvedValue(null); // No default config

    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'test-bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly and knowledgeable',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.personality).toMatchObject({
      id: 'personality-123',
      name: 'Test Bot',
      slug: 'test-bot',
    });
    expect(prisma.personality.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Test Bot',
        slug: 'test-bot',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly and knowledgeable',
        voiceEnabled: false,
        imageEnabled: false,
      }),
    });
  });

  it('should reject creation with missing required fields', async () => {
    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      // Missing slug, characterInfo, personalityTraits
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should reject creation with invalid slug format', async () => {
    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'Invalid Slug!', // Contains uppercase and special chars
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should reject creation when slug already exists', async () => {
    prisma.personality.findUnique.mockResolvedValue({
      id: 'existing-123',
      slug: 'test-bot',
    } as never);

    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'test-bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBeDefined();
  });
});
