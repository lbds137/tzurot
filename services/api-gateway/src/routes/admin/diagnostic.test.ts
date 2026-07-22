/**
 * Tests for Admin Diagnostic Routes
 *
 * Tests the LLM diagnostic log retrieval endpoints:
 * - GET /admin/diagnostic/recent - List recent logs with filtering
 * - GET /admin/diagnostic/by-message/:messageId - Get logs by Discord trigger message ID
 * - GET /admin/diagnostic/by-response/:messageId - Get logs by AI response message ID
 * - GET /admin/diagnostic/:requestId - Get full diagnostic payload
 * - PATCH /admin/diagnostic/:requestId/response-ids - Update response message IDs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDiagnosticRoutes } from './diagnostic.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import express from 'express';
import request from 'supertest';
import { findRoute, getAllRoutes } from '../../test/expressRouterUtils.js';

/** Configurable userId injected by the mocked requireUserAuth — flip per test. */
let mockCallerUserId = 'admin-discord-id';

/** Owner ID resolved by the mocked isBotOwner. Matches mockCallerUserId by default. */
const MOCK_OWNER_ID = 'admin-discord-id';

// Mock logger and isBotOwner — the route handlers branch on isBotOwner to
// decide whether to apply the userId WHERE-clause filter.
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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (id: string) => id === MOCK_OWNER_ID,
  };
});

// Mock AuthMiddleware — auth gating runs unconditionally in tests. Each mock
// stamps a unique marker on the request so the route-registration test can
// verify which middleware is wired to each route by identity (not just by
// stack depth). requireUserAuth injects mockCallerUserId for the
// isBotOwner branching in the route handlers.
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth:
    () => (req: { userId?: string; __authMarker?: string }, _res: unknown, next: () => void) => {
      req.__authMarker = 'user';
      req.userId = mockCallerUserId;
      next();
    },
  requireServiceAuth: () => (req: { __authMarker?: string }, _res: unknown, next: () => void) => {
    req.__authMarker = 'service';
    next();
  },
}));

describe('Admin Diagnostic Routes', () => {
  describe('middleware composition', () => {
    it('wires an auth middleware on every route', () => {
      // GET routes get requireUserAuth (with server-side userId filtering for
      // non-owners); PATCH gets requireServiceAuth (internal call only).
      // The structural test only inspects the resulting router stack length.
      const routes = getAllRoutes(createDiagnosticRoutes({} as unknown as PrismaClient));
      expect(routes.length, 'expected at least one registered route').toBeGreaterThan(0);
      for (const route of routes) {
        expect(route.stackLength, `${route.path} missing auth middleware`).toBeGreaterThanOrEqual(
          2
        );
      }
    });

    // Structural stack-length is not enough — accidentally swapping
    // requireServiceAuth and requireUserAuth would keep stack depth the same
    // but flip which authentication contract guards each route. The mocks set
    // a distinct `__authMarker` on the request so we can verify which
    // middleware is actually registered at each route by identity.
    it('wires requireUserAuth on GET routes and requireServiceAuth on PATCH', () => {
      const router = createDiagnosticRoutes({} as unknown as PrismaClient);

      const expectations: { method: 'get' | 'patch'; path: string; marker: string }[] = [
        { method: 'get', path: '/recent', marker: 'user' },
        { method: 'get', path: '/by-message/:messageId', marker: 'user' },
        { method: 'get', path: '/by-response/:messageId', marker: 'user' },
        { method: 'get', path: '/:requestId', marker: 'user' },
        { method: 'patch', path: '/:requestId/response-ids', marker: 'service' },
      ];

      for (const { method, path, marker } of expectations) {
        const layer = findRoute(router, method, path);
        if (layer?.route === undefined) {
          throw new Error(`Expected route registered: ${method.toUpperCase()} ${path}`);
        }
        // The first stack entry is the auth middleware; the last is the
        // route handler. We invoke the auth middleware directly with a
        // synthetic req so it stamps its marker.
        const authMiddleware = layer.route.stack[0].handle;
        const req: { __authMarker?: string; userId?: string } = {};
        const next = vi.fn();
        authMiddleware(req, {} as object, next);
        expect(
          req.__authMarker,
          `${method.toUpperCase()} ${path} wired wrong auth middleware`
        ).toBe(marker);
        expect(next).toHaveBeenCalled();
      }
    });
  });

  let mockPrisma: {
    llmDiagnosticLog: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
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
      freshModeEnabled: false,
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
      allParams: {},
    },
    llmResponse: {
      rawContent: 'Hi there!',
      finishReason: 'stop',
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
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };

    app = express();
    app.use(express.json());
    app.use('/admin/diagnostic', createDiagnosticRoutes(mockPrisma as unknown as PrismaClient));
  });

  describe('GET /admin/diagnostic/recent', () => {
    it('should return recent logs with personalityName from JSONB', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'log-1',
          request_id: 'req-1',
          personality_id: 'personality-1',
          user_id: 'user-1',
          guild_id: 'guild-1',
          channel_id: 'channel-1',
          model: 'claude-3-5-sonnet',
          provider: 'anthropic',
          duration_ms: 1000,
          created_at: new Date('2026-01-22T12:00:00Z'),
          personality_name: 'Test Personality',
        },
        {
          id: 'log-2',
          request_id: 'req-2',
          personality_id: 'personality-2',
          user_id: 'user-2',
          guild_id: 'guild-2',
          channel_id: 'channel-2',
          model: 'gpt-4',
          provider: 'openai',
          duration_ms: 2000,
          created_at: new Date('2026-01-22T11:00:00Z'),
          personality_name: null,
        },
      ]);

      const response = await request(app).get('/admin/diagnostic/recent');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(2);
      expect(response.body.count).toBe(2);
      expect(response.body.logs[0].personalityName).toBe('Test Personality');
      expect(response.body.logs[0].requestId).toBe('req-1');
      expect(response.body.logs[1].personalityName).toBeNull();
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should filter by personalityId', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const response = await request(app).get(
        '/admin/diagnostic/recent?personalityId=00000000-0000-0000-0000-000000000001'
      );

      expect(response.status).toBe(200);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Verify the tagged template static parts include base SQL structure
      const templateStrings = mockPrisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(templateStrings.join('?')).toContain('llm_diagnostic_logs');
      expect(templateStrings.join('?')).toContain('ORDER BY');
    });

    it('should filter by userId', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const response = await request(app).get('/admin/diagnostic/recent?userId=user-123');

      expect(response.status).toBe(200);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should filter by channelId', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const response = await request(app).get('/admin/diagnostic/recent?channelId=channel-456');

      expect(response.status).toBe(200);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should combine multiple filters', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const response = await request(app).get(
        '/admin/diagnostic/recent?personalityId=00000000-0000-0000-0000-000000000002&userId=u1&channelId=c1'
      );

      expect(response.status).toBe(200);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should return empty results without filters', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const response = await request(app).get('/admin/diagnostic/recent');

      expect(response.status).toBe(200);
      expect(response.body.logs).toEqual([]);
      expect(response.body.count).toBe(0);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Verify the tagged template includes expected SQL structure
      const templateStrings = mockPrisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(templateStrings.join('?')).toContain('personality_name');
    });

    it('should ignore empty string filters', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const response = await request(app).get(
        '/admin/diagnostic/recent?personalityId=&userId=user-1'
      );

      expect(response.status).toBe(200);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid UUID for personalityId', async () => {
      const response = await request(app).get('/admin/diagnostic/recent?personalityId=not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid personalityId format');
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('should safely handle SQL injection attempts in filters', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      // SQL injection in userId — Prisma parameterizes this, so it's safe
      const response = await request(app).get(
        "/admin/diagnostic/recent?userId='; DROP TABLE users; --"
      );

      expect(response.status).toBe(200);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
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

  describe('GET /admin/diagnostic/by-response/:messageId', () => {
    it('should return log for a valid response message ID', async () => {
      mockPrisma.llmDiagnosticLog.findFirst.mockResolvedValue({
        id: 'log-uuid',
        requestId: 'test-req-123',
        triggerMessageId: '1234567890123456789',
        responseMessageIds: ['9999888877776666555', '9999888877776666556'],
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

      const response = await request(app).get('/admin/diagnostic/by-response/9999888877776666555');

      expect(response.status).toBe(200);
      expect(response.body.log.requestId).toBe('test-req-123');
      expect(mockPrisma.llmDiagnosticLog.findFirst).toHaveBeenCalledWith({
        where: {
          responseMessageIds: { has: '9999888877776666555' },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return 404 when no log contains the response message ID', async () => {
      mockPrisma.llmDiagnosticLog.findFirst.mockResolvedValue(null);

      const response = await request(app).get('/admin/diagnostic/by-response/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should work with any chunk in a multi-chunk response', async () => {
      // Response was split into 3 chunks, looking up by the middle chunk
      mockPrisma.llmDiagnosticLog.findFirst.mockResolvedValue({
        id: 'log-uuid',
        requestId: 'chunked-req',
        triggerMessageId: '1111111111111111111',
        responseMessageIds: ['chunk-1', 'chunk-2', 'chunk-3'],
        personalityId: 'p-uuid',
        userId: 'u-123',
        guildId: 'g-456',
        channelId: 'c-789',
        model: 'test',
        provider: 'test',
        durationMs: 1000,
        createdAt: new Date(),
        data: mockDiagnosticPayload,
      });

      const response = await request(app).get('/admin/diagnostic/by-response/chunk-2');

      expect(response.status).toBe(200);
      expect(mockPrisma.llmDiagnosticLog.findFirst).toHaveBeenCalledWith({
        where: { responseMessageIds: { has: 'chunk-2' } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('PATCH /admin/diagnostic/:requestId/response-ids', () => {
    it('should update response message IDs', async () => {
      mockPrisma.llmDiagnosticLog.update.mockResolvedValue({
        requestId: 'test-req-123',
        responseMessageIds: ['msg-1', 'msg-2'],
      });

      const response = await request(app)
        .patch('/admin/diagnostic/test-req-123/response-ids')
        .send({ responseMessageIds: ['msg-1', 'msg-2'] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrisma.llmDiagnosticLog.update).toHaveBeenCalledWith({
        where: { requestId: 'test-req-123' },
        data: { responseMessageIds: ['msg-1', 'msg-2'] },
      });
    });

    it('should accept single message ID array', async () => {
      mockPrisma.llmDiagnosticLog.update.mockResolvedValue({
        requestId: 'test-req',
        responseMessageIds: ['single-msg'],
      });

      const response = await request(app)
        .patch('/admin/diagnostic/test-req/response-ids')
        .send({ responseMessageIds: ['single-msg'] });

      expect(response.status).toBe(200);
      expect(mockPrisma.llmDiagnosticLog.update).toHaveBeenCalledWith({
        where: { requestId: 'test-req' },
        data: { responseMessageIds: ['single-msg'] },
      });
    });

    it('should return 400 if responseMessageIds is not an array', async () => {
      const response = await request(app)
        .patch('/admin/diagnostic/test-req/response-ids')
        .send({ responseMessageIds: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(expect.stringContaining('responseMessageIds'));
    });

    it('should return 400 if responseMessageIds is missing', async () => {
      const response = await request(app).patch('/admin/diagnostic/test-req/response-ids').send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(expect.stringContaining('responseMessageIds'));
    });

    it('should return 400 if array contains non-strings', async () => {
      const response = await request(app)
        .patch('/admin/diagnostic/test-req/response-ids')
        .send({ responseMessageIds: ['valid', 123, 'also-valid'] });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(expect.stringContaining('responseMessageIds'));
    });

    it('should return 400 if array contains empty strings', async () => {
      const response = await request(app)
        .patch('/admin/diagnostic/test-req/response-ids')
        .send({ responseMessageIds: ['valid', '', 'also-valid'] });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(expect.stringContaining('responseMessageIds'));
    });

    it('should return 404 when diagnostic log not found', async () => {
      mockPrisma.llmDiagnosticLog.update.mockRejectedValue({ code: 'P2025' });

      const response = await request(app)
        .patch('/admin/diagnostic/nonexistent/response-ids')
        .send({ responseMessageIds: ['msg-1'] });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should propagate other errors', async () => {
      mockPrisma.llmDiagnosticLog.update.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .patch('/admin/diagnostic/test-req/response-ids')
        .send({ responseMessageIds: ['msg-1'] });

      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Server-side per-user filtering — non-owner callers must only see their
  // own logs. The filter is applied at the Prisma WHERE clause; never at the
  // bot-client (see council Q2 / `/inspect` rearchitecture).
  // -------------------------------------------------------------------------
  describe('server-side userId filtering for non-owner callers', () => {
    /** Restore the default owner caller after each non-owner test. */
    afterEach(() => {
      mockCallerUserId = 'admin-discord-id';
    });

    it('GET /recent — non-owner ignores ?userId= query and forces caller as filter', async () => {
      mockCallerUserId = 'regular-user-789';
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?userId=someone-else');

      // The owner can pass ?userId=; non-owners get forced to their own ID.
      // Verify by inspecting the SQL fragments passed to $queryRaw.
      const callArgs = mockPrisma.$queryRaw.mock.calls[0];
      const fragmentValues = JSON.stringify(callArgs);
      expect(fragmentValues).toContain('regular-user-789');
      expect(fragmentValues).not.toContain('someone-else');
    });

    it('GET /recent — owner can use ?userId= to inspect another user', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/recent?userId=someone-else');

      const fragmentValues = JSON.stringify(mockPrisma.$queryRaw.mock.calls[0]);
      expect(fragmentValues).toContain('someone-else');
    });

    it('GET /by-message/:messageId — non-owner filter narrows to own userId', async () => {
      mockCallerUserId = 'regular-user-789';
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/by-message/some-message-id');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { triggerMessageId: 'some-message-id', userId: 'regular-user-789' },
        })
      );
    });

    it('GET /by-message/:messageId — owner gets no userId filter', async () => {
      mockPrisma.llmDiagnosticLog.findMany.mockResolvedValue([]);

      await request(app).get('/admin/diagnostic/by-message/some-message-id');

      expect(mockPrisma.llmDiagnosticLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { triggerMessageId: 'some-message-id' },
        })
      );
    });

    it('GET /by-response/:messageId — non-owner filter narrows to own userId', async () => {
      mockCallerUserId = 'regular-user-789';
      mockPrisma.llmDiagnosticLog.findFirst.mockResolvedValue(null);

      await request(app).get('/admin/diagnostic/by-response/chunk-1');

      expect(mockPrisma.llmDiagnosticLog.findFirst).toHaveBeenCalledWith({
        where: { responseMessageIds: { has: 'chunk-1' }, userId: 'regular-user-789' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('GET /by-response/:messageId — owner gets no userId filter', async () => {
      mockPrisma.llmDiagnosticLog.findFirst.mockResolvedValue(null);

      await request(app).get('/admin/diagnostic/by-response/chunk-1');

      expect(mockPrisma.llmDiagnosticLog.findFirst).toHaveBeenCalledWith({
        where: { responseMessageIds: { has: 'chunk-1' } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('GET /:requestId — owner WHERE clause is just { requestId } (no userId filter)', async () => {
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue({
        id: 'log-id',
        requestId: 'test-req-123',
        triggerMessageId: 'msg-1',
        personalityId: 'p-1',
        userId: 'some-random-user',
        guildId: 'g-1',
        channelId: 'c-1',
        responseMessageIds: [],
        model: 'claude-3-5-sonnet',
        provider: 'anthropic',
        durationMs: 1000,
        createdAt: new Date(),
        data: mockDiagnosticPayload,
      });

      const response = await request(app).get('/admin/diagnostic/test-req-123');

      expect(response.status).toBe(200);
      expect(mockPrisma.llmDiagnosticLog.findUnique).toHaveBeenCalledWith({
        where: { requestId: 'test-req-123' },
      });
    });

    it('GET /:requestId — non-owner gets 404 (not 403) when log belongs to another user', async () => {
      mockCallerUserId = 'regular-user-789';
      // The handler now pushes the userId filter into the Prisma WHERE clause
      // for non-owners, so a "log exists but belongs to someone else" outcome
      // is observed at this layer as Prisma returning null (filtered at the
      // DB). The mock simulates that — findUnique called with the userId
      // filter, no matching row, returns null. 404 results.
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/admin/diagnostic/test-req-123');

      expect(response.status).toBe(404);
      // Verify the userId filter is part of the WHERE clause — otherwise a
      // future regression that re-fetches without the filter would still
      // produce 404 in this test (mock returns null unconditionally) but
      // would leak data in production.
      expect(mockPrisma.llmDiagnosticLog.findUnique).toHaveBeenCalledWith({
        where: { requestId: 'test-req-123', userId: 'regular-user-789' },
      });
    });

    it('GET /:requestId — non-owner sees own log', async () => {
      mockCallerUserId = 'regular-user-789';
      mockPrisma.llmDiagnosticLog.findUnique.mockResolvedValue({
        id: 'log-id',
        requestId: 'test-req-123',
        triggerMessageId: 'msg-1',
        personalityId: 'p-1',
        userId: 'regular-user-789',
        guildId: 'g-1',
        channelId: 'c-1',
        responseMessageIds: [],
        model: 'claude-3-5-sonnet',
        provider: 'anthropic',
        durationMs: 1000,
        createdAt: new Date(),
        data: mockDiagnosticPayload,
      });

      const response = await request(app).get('/admin/diagnostic/test-req-123');

      expect(response.status).toBe(200);
      expect(response.body.log.requestId).toBe('test-req-123');
      // WHERE clause should include the userId filter for non-owners.
      expect(mockPrisma.llmDiagnosticLog.findUnique).toHaveBeenCalledWith({
        where: { requestId: 'test-req-123', userId: 'regular-user-789' },
      });
    });
  });
});
