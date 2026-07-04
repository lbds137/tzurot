/**
 * Component Test: AIJobProcessor
 *
 * Tests the AI job processing pipeline with:
 * - REAL: Prisma DB (PGlite), result persistence, Redis publishing path
 * - MOCKED: ConversationalRAGService (AI provider); ContextStep (the
 *   envelope-assembly step, unit-tested in ContextStep.test.ts) — stubbed to a
 *   pass-through so these fixtures don't need to satisfy the kind:'envelope'
 *   contract the real step enforces, and so the assembler's own prisma
 *   singleton isn't exercised against this PGlite harness.
 *
 * This verifies the critical path:
 * Job routing → Processing → DB persistence → Redis publishing
 *
 * AIJobProcessor is the core service that processes all AI jobs; these tests
 * catch breaking changes in routing, result persistence, and async delivery.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { AIJobProcessor } from './AIJobProcessor.js';
import type { ConversationalRAGService } from '../services/ConversationalRAGService.js';
import type { RAGResponse } from '../services/ConversationalRAGTypes.js';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import {
  generateSystemPromptUuid,
  generatePersonalityUuid,
  generatePersonaUuid,
  generateUserUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { GenerationContext } from './handlers/pipeline/types.js';
import type { Job } from 'bullmq';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';

// Mock Redis service to avoid real Redis dependency
vi.mock('../redis.js', () => ({
  redisService: {
    publishJobResult: vi.fn().mockResolvedValue(undefined),
    storeJobResult: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock cleanup function to avoid background processing during tests
vi.mock('./CleanupJobResults.js', () => ({
  cleanupOldJobResults: vi.fn().mockResolvedValue(undefined),
}));

// ContextStep is unit-tested separately (ContextStep.test.ts). Here it's stubbed
// to a pass-through that produces an empty preparedContext, so this component
// test exercises routing + persistence rather than envelope-assembly internals.
// The real step now requires kind:'envelope' jobs and a wired assembler whose
// PrismaContextDataSource reads the prisma SINGLETON — neither of which this
// PGlite-backed harness provides — so stubbing keeps the harness honest.
vi.mock('./handlers/pipeline/steps/ContextStep.js', () => ({
  ContextStep: class {
    readonly name = 'ContextPreparation';
    process(context: GenerationContext): Promise<GenerationContext> {
      return Promise.resolve({
        ...context,
        preparedContext: {
          conversationHistory: [],
          rawConversationHistory: [],
          oldestHistoryTimestamp: undefined,
          participants: [],
          crossChannelHistory: undefined,
        },
      });
    }
  },
}));

describe('AIJobProcessor Component Test', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let mockRagService: ConversationalRAGService;
  let jobProcessor: AIJobProcessor;

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM) with pgvector extension
    // Note: PGlite initialization is CPU-intensive and may be slow when running
    // in parallel with other tests, hence the extended timeout
    pglite = createTestPGlite();

    // Load the complete schema from the shared schema file
    // This ensures integration tests stay in sync with migrations
    await pglite.exec(loadPGliteSchema());

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Seed test data (using deterministic UUIDs for consistency)

    // Create test user + default persona atomically (default_persona_id is NOT NULL).
    const testDiscordId = 'test-discord-id';
    const testUserId = generateUserUuid(testDiscordId);
    await seedUserWithPersona(prisma, {
      userId: testUserId,
      personaId: generatePersonaUuid('test-user', testUserId),
      discordId: testDiscordId,
      username: 'test-user',
      personaName: 'test-user',
    });
    const testUser = { id: testUserId };

    const systemPrompt = await prisma.systemPrompt.create({
      data: {
        id: generateSystemPromptUuid('test-component-prompt'),
        name: 'test-component-prompt',
        content: 'You are a test assistant for component testing.',
      },
    });

    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('test-component'),
        name: 'TestComponent',
        slug: 'test-component',
        displayName: 'Test Component Bot',
        systemPromptId: systemPrompt.id,
        ownerId: testUser.id,
        characterInfo: 'A test bot for component testing',
        personalityTraits: 'Helpful and deterministic',
      },
    });

    // Create global default LLM config
    await prisma.llmConfig.create({
      data: {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Global Default',
        ownerId: testUser.id,
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        advancedParameters: {
          temperature: 0.7,
          maxTokens: 4000,
        },
      },
    });
  }, 30000); // 30 second timeout for PGlite WASM initialization under parallel load

  beforeEach(() => {
    // Create mock RAG service with deterministic responses
    mockRagService = {
      generateResponse: vi.fn().mockResolvedValue({
        content: 'This is a mocked AI response for testing',
        retrievedMemories: 5,
        tokensIn: 100,
        tokensOut: 50,
        modelUsed: 'anthropic/claude-sonnet-4',
      } as RAGResponse),
    } as unknown as ConversationalRAGService;

    // Create job processor with mocked RAG service
    jobProcessor = new AIJobProcessor({ prisma, ragService: mockRagService });
  });

  afterAll(async () => {
    // Cleanup: Disconnect Prisma and close PGlite
    // No need to delete data - PGlite is in-memory and will be discarded
    await prisma.$disconnect();
    await pglite.close();
  }, 30000); // 30 second timeout for cleanup under parallel load

  describe('LLM Generation Job Processing', () => {
    it('should process LLM generation job and persist result to database', async () => {
      const requestId = 'test-component-llm-gen-1';
      const jobId = 'job-test-component-1';

      const jobData: LLMGenerationJobData = {
        requestId,
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'personality-test-id',
          name: 'TestComponent',
          displayName: 'Test Component Bot',
          slug: 'test-component',
          ownerId: 'owner-uuid-test',
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
          voiceEnabled: false,
        },
        message: 'Hello, test bot!',
        context: {
          userId: 'user-test-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-test-123',
        },
      };

      const mockJob = {
        id: jobId,
        data: jobData,
      } as Job<LLMGenerationJobData>;

      // Process the job
      const rawResult = await jobProcessor.processJob(mockJob);
      const result =
        rawResult as import('@tzurot/common-types/types/schemas/generation').LLMGenerationResult;

      // Verify RAG service was called
      expect(mockRagService.generateResponse).toHaveBeenCalledTimes(1);

      // Verify result structure
      expect(result).toMatchObject({
        requestId,
        success: true,
        content: 'This is a mocked AI response for testing',
        metadata: {
          retrievedMemories: 5,
          tokensIn: 100,
          tokensOut: 50,
          modelUsed: 'anthropic/claude-sonnet-4',
        },
      });

      // processingTimeMs is calculated, just verify it exists and is a number
      expect(result.metadata?.processingTimeMs).toBeDefined();
      expect(typeof result.metadata?.processingTimeMs).toBe('number');

      // Verify result was persisted to database
      const persistedResult = await prisma.jobResult.findUnique({
        where: { jobId },
      });

      expect(persistedResult).toBeDefined();
      expect(persistedResult?.requestId).toBe(requestId);
      expect(persistedResult?.status).toBe('PENDING_DELIVERY');
      expect(persistedResult?.completedAt).toBeDefined();
    });

    it('should handle job processing errors gracefully', async () => {
      const requestId = 'test-component-llm-gen-error';
      const jobId = 'job-test-component-error';

      // Mock RAG service to throw an error
      vi.mocked(mockRagService.generateResponse).mockRejectedValueOnce(
        new Error('Mocked AI provider error')
      );

      const jobData: LLMGenerationJobData = {
        requestId,
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'personality-test-id',
          name: 'TestComponent',
          displayName: 'Test Component Bot',
          slug: 'test-component',
          ownerId: 'owner-uuid-test',
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
          voiceEnabled: false,
        },
        message: 'This will fail',
        context: {
          userId: 'user-test-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-test-123',
        },
      };

      const mockJob = {
        id: jobId,
        data: jobData,
      } as Job<LLMGenerationJobData>;

      // Process the job - errors are caught and returned as failed results
      const rawResult = await jobProcessor.processJob(mockJob);
      const result =
        rawResult as import('@tzurot/common-types/types/schemas/generation').LLMGenerationResult;

      // Verify error is captured in result
      expect(result.success).toBe(false);
      expect(result.error).toBe('Mocked AI provider error');
      expect(result.metadata?.processingTimeMs).toBeDefined();
    });
  });

  describe('Job Routing', () => {
    it('should route llm-generation jobs to LLM handler', async () => {
      const requestId = 'test-component-routing-llm';
      const jobId = 'job-routing-llm';

      const jobData: LLMGenerationJobData = {
        requestId,
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'personality-test-id',
          name: 'TestComponent',
          displayName: 'Test Component Bot',
          slug: 'test-component',
          ownerId: 'owner-uuid-test',
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
          voiceEnabled: false,
        },
        message: 'Test routing',
        context: {
          userId: 'user-test-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-test-123',
        },
      };

      const mockJob = {
        id: jobId,
        data: jobData,
      } as Job<LLMGenerationJobData>;

      await jobProcessor.processJob(mockJob);

      // Verify RAG service (LLM handler) was called
      expect(mockRagService.generateResponse).toHaveBeenCalled();
    });

    it('should reject unknown job types', async () => {
      const requestId = 'test-component-routing-unknown';
      const jobId = 'job-routing-unknown';

      const jobData = {
        requestId,
        jobType: 'unknown-type' as JobType,
        context: { userId: 'user-test-123' },
        responseDestination: { type: 'discord', channelId: 'channel-test-123' },
      };

      const mockJob = {
        id: jobId,
        data: jobData,
      } as unknown as Job;

      await expect(jobProcessor.processJob(mockJob)).rejects.toThrow('Unknown job type');
    });
  });

  describe('Result Persistence', () => {
    it('should persist job results with PENDING_DELIVERY status', async () => {
      const requestId = 'test-component-persistence-1';
      const jobId = 'job-persistence-1';

      const jobData: LLMGenerationJobData = {
        requestId,
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'personality-test-id',
          name: 'TestComponent',
          displayName: 'Test Component Bot',
          slug: 'test-component',
          ownerId: 'owner-uuid-test',
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
          voiceEnabled: false,
        },
        message: 'Test persistence',
        context: {
          userId: 'user-test-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-test-123',
        },
      };

      const mockJob = {
        id: jobId,
        data: jobData,
      } as Job<LLMGenerationJobData>;

      await jobProcessor.processJob(mockJob);

      // Query the database directly
      const persistedResult = await prisma.jobResult.findUnique({
        where: { jobId },
      });

      expect(persistedResult).not.toBeNull();
      expect(persistedResult?.jobId).toBe(jobId);
      expect(persistedResult?.requestId).toBe(requestId);
      expect(persistedResult?.status).toBe('PENDING_DELIVERY');
      expect(persistedResult?.result).toBeDefined();
      expect(persistedResult?.completedAt).toBeInstanceOf(Date);
      expect(persistedResult?.deliveredAt).toBeNull();
    });
  });
});
