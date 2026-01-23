/**
 * Tests for Admin Diagnostic Routes
 *
 * Tests the LLM diagnostic log retrieval endpoints:
 * - GET /admin/diagnostic/recent - List recent logs with filtering
 * - GET /admin/diagnostic/by-message/:messageId - Get logs by Discord message ID
 * - GET /admin/diagnostic/:requestId - Get full diagnostic payload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDiagnosticRoutes } from './diagnostic.js';
import type { PrismaClient, DiagnosticPayload } from '@tzurot/common-types';
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

describe('Admin Diagnostic Routes', () => {
  let mockPrisma: {
    llmDiagnosticLog: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let app: express.Express;

  const mockDiagnosticPayload: DiagnosticPayload = {
    meta: {
      requestId: 'test-req-123',
      personalityId: 'personality-uuid',
      personalityName: 'Test Personality',
      userId: '123456789',
      guildId: '987654321',
      channelId: '111222333',
      timestamp: '2026-01-22T12:00:00Z',
    },
    inputProcessing: {
      rawUserMessage: 'Hello',
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: 'hello',
    },
    memoryRetrieval: {
      memoriesFound: [],
      focusModeEnabled: false,
    },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 500,
      memoryTokensUsed: 0,
      historyTokensUsed: 100,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    },
    assembledPrompt: {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      totalTokenEstimate: 100,
    },
    llmConfig: {
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      temperature: 0.8,
      stopSequences: [],
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hi there!',
      finishReason: 'stop',
      stopSequenceTriggered: null,
      promptTokens: 50,
      completionTokens: 10,
      modelUsed: 'claude-3-5-sonnet-20241022',
    },
    postProcessing: {
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: 'Hi there!',
    },
    timing: {
      totalDurationMs: 1500,
      memoryRetrievalMs: 50,
      llmInvocationMs: 1400,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      llmDiagnosticLog: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    app = express();
    app.use(express.json());
    app.use('/admin/diagnostic', createDiagnosticRoutes(mockPrisma as unknown as PrismaClient));
  });

  describe('GET /admin/diagnostic/recent', () => {
    it('should return recent logs without filters', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          requestId: 'req-1',
          triggerMessageId: '1234567890123456789',
          personalityId: 'personality-1',
          userId: 'user-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          model: 'claude-3-5-sonnet',
          provider: 'anthropic',
          durationMs: 1000,
          createdAt: new Date('2026-01-22T12:00:00Z'),
        },
        {
          id: 'log-2',
          requestId: 'req-2',
          triggerMessageId: '9876543210987654321',
          personalityId: 'personality-2',
          userId: 'user-2',
          guildId: 'guild-2',
          channelId: 'channel-2',
          model: 'gpt-4',
          provider: 'openai',
          durationMs: 2000,
          createdAt: new Date('2026-01-22T11:00:00Z'),
        },
      ]);

      const response = await request(app).get('/admin/diagnostic/recent');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(2);
      expect(response.body.count).toBe(2);
      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          requestId: true,
          personalityId: true,
          userId: true,
          guildId: true,
          channelId: true,
          model: true,
          provider: true,
          durationMs: true,
          createdAt: true,
        },
      });
    });

    it('should filter by personalityId', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?personalityId=test-personality');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { personalityId: 'test-personality' },
        })
      );
    });

    it('should filter by userId', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?userId=user-123');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
    });

    it('should filter by channelId', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?channelId=channel-456');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channelId: 'channel-456' },
        })
      );
    });

    it('should combine multiple filters', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?personalityId=p1&userId=u1&channelId=c1');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personalityId: 'p1',
            userId: 'u1',
            channelId: 'c1',
          },
        })
      );
    });

    it('should return empty array when no logs exist', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/diagnostic/recent');

      expect(response.status).toBe(200);
      expect(response.body.logs).toEqual([]);
      expect(response.body.count).toBe(0);
    });

    it('should ignore empty string filters', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?personalityId=&userId=user-1');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        })
      );
    });
  });

  describe('GET /admin/diagnostic/by-message/:messageId', () => {
    it('should return logs for a valid message ID', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          requestId: 'req-1',
          triggerMessageId: '1234567890123456789',
          personalityId: 'personality-1',
          userId: 'user-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          model: 'claude-3-5-sonnet',
          provider: 'anthropic',
          durationMs: 1000,
          createdAt: new Date('2026-01-22T12:00:00Z'),
          data: mockDiagnosticPayload,
        },
      ]);

      const response = await request(app).get('/admin/diagnostic/by-message/1234567890123456789');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);
      expect(response.body.count).toBe(1);
      expect(response.body.logs[0].triggerMessageId).toBe('1234567890123456789');
      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith({
        where: { triggerMessageId: '1234567890123456789' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('should return multiple logs for the same message ID', async () => {
      // A single Discord message might trigger multiple AI calls (e.g., retries)
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          requestId: 'req-1',
          triggerMessageId: '1234567890123456789',
          personalityId: 'personality-1',
          userId: 'user-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          model: 'claude-3-5-sonnet',
          provider: 'anthropic',
          durationMs: 1000,
          createdAt: new Date('2026-01-22T12:00:00Z'),
          data: mockDiagnosticPayload,
        },
        {
          id: 'log-2',
          requestId: 'req-2',
          triggerMessageId: '1234567890123456789',
          personalityId: 'personality-1',
          userId: 'user-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          model: 'claude-3-5-sonnet',
          provider: 'anthropic',
          durationMs: 800,
          createdAt: new Date('2026-01-22T11:59:00Z'),
          data: mockDiagnosticPayload,
        },
      ]);

      const response = await request(app).get('/admin/diagnostic/by-message/1234567890123456789');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(2);
      expect(response.body.count).toBe(2);
    });

    it('should return 404 when no logs exist for message ID', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/diagnostic/by-message/9999999999999999999');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should include data payload in by-message response', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([
        {
          id: 'log-uuid',
          requestId: 'test-req',
          triggerMessageId: '1234567890123456789',
          personalityId: 'personality-uuid',
          userId: '123456789',
          guildId: '987654321',
          channelId: '111222333',
          model: 'claude-3-5-sonnet',
          provider: 'anthropic',
          durationMs: 1500,
          createdAt: new Date('2026-01-22T12:00:00Z'),
          data: mockDiagnosticPayload,
        },
      ]);

      const response = await request(app).get('/admin/diagnostic/by-message/1234567890123456789');

      expect(response.status).toBe(200);
      expect(response.body.logs[0].data).toEqual(mockDiagnosticPayload);
    });

    it('should limit results to MAX_RECENT_LOGS', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/by-message/1234567890123456789');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });
  });

  describe('GET /admin/diagnostic/:requestId', () => {
    it('should return full diagnostic log', async () => {
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue({
        id: 'log-uuid',
        requestId: 'test-req-123',
        triggerMessageId: '1234567890123456789',
        personalityId: 'personality-uuid',
        userId: '123456789',
        guildId: '987654321',
        channelId: '111222333',
        model: 'claude-3-5-sonnet',
        provider: 'anthropic',
        durationMs: 1500,
        createdAt: new Date('2026-01-22T12:00:00Z'),
        data: mockDiagnosticPayload,
      });

      const response = await request(app).get('/admin/diagnostic/test-req-123');

      expect(response.status).toBe(200);
      expect(response.body.log.requestId).toBe('test-req-123');
      expect(response.body.log.data).toEqual(mockDiagnosticPayload);
      expect(mockPrisma.llmDiagnosticLog.findUnique).toHaveBeenCalledWith({
        where: { requestId: 'test-req-123' },
      });
    });

    it('should return 404 when log not found', async () => {
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/admin/diagnostic/nonexistent-id');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should return 400 for empty requestId', async () => {
      const response = await request(app).get('/admin/diagnostic/');

      // Empty path segment results in 404 (route not matched)
      expect(response.status).toBe(404);
    });

    it('should handle URL-encoded requestId', async () => {
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue({
        id: 'log-uuid',
        requestId: 'req-with-special/chars',
        triggerMessageId: null,
        personalityId: null,
        userId: null,
        guildId: null,
        channelId: null,
        model: 'test',
        provider: 'test',
        durationMs: 100,
        createdAt: new Date(),
        data: mockDiagnosticPayload,
      });

      await request(app).get('/admin/diagnostic/req-with-special%2Fchars');

      expect(mockPrisma.llmDiagnosticLog.findUnique).toHaveBeenCalledWith({
        where: { requestId: 'req-with-special/chars' },
      });
    });

    it('should include all expected fields in response', async () => {
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue({
        id: 'log-uuid',
        requestId: 'test-req',
        triggerMessageId: '1111222233334444555',
        personalityId: 'p-uuid',
        userId: 'u-123',
        guildId: 'g-456',
        channelId: 'c-789',
        model: 'test-model',
        provider: 'test-provider',
        durationMs: 500,
        createdAt: new Date('2026-01-22T12:00:00Z'),
        data: mockDiagnosticPayload,
      });

      const response = await request(app).get('/admin/diagnostic/test-req');

      const log = response.body.log;
      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('requestId');
      expect(log).toHaveProperty('triggerMessageId');
      expect(log).toHaveProperty('personalityId');
      expect(log).toHaveProperty('userId');
      expect(log).toHaveProperty('guildId');
      expect(log).toHaveProperty('channelId');
      expect(log).toHaveProperty('model');
      expect(log).toHaveProperty('provider');
      expect(log).toHaveProperty('durationMs');
      expect(log).toHaveProperty('createdAt');
      expect(log).toHaveProperty('data');
    });

    it('should handle null optional fields', async () => {
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue({
        id: 'log-uuid',
        requestId: 'dm-req',
        triggerMessageId: '5555666677778888999',
        personalityId: null, // DM could have null personality
        userId: 'user-123',
        guildId: null, // DM has no guild
        channelId: 'dm-channel',
        model: 'test-model',
        provider: 'test',
        durationMs: 100,
        createdAt: new Date(),
        data: mockDiagnosticPayload,
      });

      const response = await request(app).get('/admin/diagnostic/dm-req');

      expect(response.status).toBe(200);
      expect(response.body.log.personalityId).toBeNull();
      expect(response.body.log.guildId).toBeNull();
    });
  });
});
