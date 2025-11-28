/**
 * Tests for Admin Usage Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminUsageRoutes } from './usage.js';
import type { PrismaClient } from '@tzurot/common-types';
import express from 'express';
import request from 'supertest';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('Admin Usage Routes', () => {
  let mockPrisma: {
    usageLog: {
      findMany: ReturnType<typeof vi.fn>;
    };
    user: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      usageLog: {
        findMany: vi.fn(),
      },
      user: {
        findMany: vi.fn(),
      },
    };

    app = express();
    app.use(express.json());
    app.use('/admin/usage', createAdminUsageRoutes(mockPrisma as unknown as PrismaClient));
  });

  describe('GET /admin/usage', () => {
    it('should return usage stats with default 7d timeframe', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          tokensIn: 200,
          tokensOut: 100,
          requestType: 'chat',
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', discordId: 'discord-123' }]);

      const response = await request(app).get('/admin/usage');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('7d');
      expect(response.body.totalRequests).toBe(2);
      expect(response.body.totalTokensIn).toBe(300);
      expect(response.body.totalTokensOut).toBe(150);
      expect(response.body.totalTokens).toBe(450);
      expect(response.body.uniqueUsers).toBe(1);
    });

    it('should accept custom timeframe', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/usage?timeframe=30d');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('30d');
    });

    it('should aggregate by provider', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'model-1',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          userId: 'user-1',
          provider: 'anthropic',
          model: 'model-2',
          tokensIn: 200,
          tokensOut: 100,
          requestType: 'chat',
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', discordId: 'discord-123' }]);

      const response = await request(app).get('/admin/usage');

      expect(response.body.byProvider.openrouter).toEqual({
        requests: 1,
        tokensIn: 100,
        tokensOut: 50,
      });
      expect(response.body.byProvider.anthropic).toEqual({
        requests: 1,
        tokensIn: 200,
        tokensOut: 100,
      });
    });

    it('should aggregate by model', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'claude-sonnet',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'gpt-4',
          tokensIn: 200,
          tokensOut: 100,
          requestType: 'chat',
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', discordId: 'discord-123' }]);

      const response = await request(app).get('/admin/usage');

      expect(response.body.byModel['claude-sonnet']).toEqual({
        requests: 1,
        tokensIn: 100,
        tokensOut: 50,
      });
      expect(response.body.byModel['gpt-4']).toEqual({
        requests: 1,
        tokensIn: 200,
        tokensOut: 100,
      });
    });

    it('should aggregate by request type', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'model-1',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'model-1',
          tokensIn: 50,
          tokensOut: 25,
          requestType: 'vision',
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', discordId: 'discord-123' }]);

      const response = await request(app).get('/admin/usage');

      expect(response.body.byRequestType.chat).toEqual({
        requests: 1,
        tokensIn: 100,
        tokensOut: 50,
      });
      expect(response.body.byRequestType.vision).toEqual({
        requests: 1,
        tokensIn: 50,
        tokensOut: 25,
      });
    });

    it('should return top users sorted by token usage', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          provider: 'openrouter',
          model: 'model-1',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'chat',
        },
        {
          userId: 'user-2',
          provider: 'openrouter',
          model: 'model-1',
          tokensIn: 500,
          tokensOut: 250,
          requestType: 'chat',
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-1', discordId: 'discord-123' },
        { id: 'user-2', discordId: 'discord-456' },
      ]);

      const response = await request(app).get('/admin/usage');

      expect(response.body.topUsers).toHaveLength(2);
      // User 2 should be first (more tokens)
      expect(response.body.topUsers[0].discordId).toBe('discord-456');
      expect(response.body.topUsers[0].tokens).toBe(750);
      expect(response.body.topUsers[1].discordId).toBe('discord-123');
      expect(response.body.topUsers[1].tokens).toBe(150);
    });

    it('should return empty stats when no usage', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/usage');

      expect(response.status).toBe(200);
      expect(response.body.totalRequests).toBe(0);
      expect(response.body.totalTokens).toBe(0);
      expect(response.body.uniqueUsers).toBe(0);
      expect(response.body.topUsers).toEqual([]);
    });

    it('should handle hours timeframe', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/usage?timeframe=24h');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('24h');
      expect(response.body.periodStart).not.toBeNull();
    });

    it('should handle weeks timeframe', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/usage?timeframe=2w');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('2w');
    });

    it('should handle months timeframe', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/usage?timeframe=3m');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('3m');
    });

    it('should handle invalid timeframe gracefully (no date filter)', async () => {
      mockPrisma.usageLog.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/usage?timeframe=invalid');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('invalid');
      expect(response.body.periodStart).toBeNull();
    });
  });
});
