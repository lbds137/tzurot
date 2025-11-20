/**
 * Update Personality Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createUpdatePersonalityRoute } from './updatePersonality.js';
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

describe('PATCH /admin/personality/:slug', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    prisma = createMockPrismaClient();

    // Create Express app with update personality router
    app = express();
    app.use(express.json());
    app.use('/admin/personality', createUpdatePersonalityRoute(prisma as unknown as PrismaClient));
  });

  it('should update an existing personality', async () => {
    prisma.personality.findUnique.mockResolvedValue({
      id: 'personality-123',
      slug: 'test-bot',
    } as never);
    prisma.personality.update.mockResolvedValue({
      id: 'personality-123',
      name: 'Updated Bot',
      slug: 'test-bot',
      displayName: null,
      avatarData: null,
    } as never);

    const response = await request(app).patch('/admin/personality/test-bot').send({
      name: 'Updated Bot',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.personality.name).toBe('Updated Bot');
    expect(prisma.personality.update).toHaveBeenCalledWith({
      where: { slug: 'test-bot' },
      data: { name: 'Updated Bot' },
    });
  });

  it('should return 404 when personality does not exist', async () => {
    prisma.personality.findUnique.mockResolvedValue(null);

    const response = await request(app).patch('/admin/personality/nonexistent').send({
      name: 'Updated Bot',
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
  });
});
