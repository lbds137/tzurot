/**
 * Component Test: AIJobProcessor
 *
 * Tests the AI job processing pipeline with:
 * - REAL: Prisma DB, conversation history queries, result persistence
 * - MOCKED: ConversationalRAGService (AI provider)
 *
 * This verifies the critical path:
 * Job routing → Processing → DB persistence → Redis publishing
 *
 * WHY THIS IS CRITICAL FOR PHASE 0:
 * - Phase 1 will refactor the database schema extensively
 * - AIJobProcessor is the core service that processes all AI jobs
 * - These tests catch breaking changes in job processing logic
 * - Ensures result persistence and async delivery patterns work correctly
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { AIJobProcessor } from './AIJobProcessor.js';
import type {
  ConversationalRAGService,
  RAGResponse,
} from '../services/ConversationalRAGService.js';
import { JobType, MessageRole, type LLMGenerationJobData } from '@tzurot/common-types';
import type { Job } from 'bullmq';
import { PrismaClient } from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

describe('AIJobProcessor Component Test', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let mockRagService: ConversationalRAGService;
  let jobProcessor: AIJobProcessor;

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM)
    // Note: PGlite initialization is CPU-intensive and may be slow when running
    // in parallel with other tests, hence the extended timeout
    pglite = new PGlite();

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Apply minimal schema to PGlite (using actual table names from Prisma schema)
    // Execute each CREATE TABLE separately
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS system_prompts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS llm_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        owner_id UUID,
        is_global BOOLEAN DEFAULT FALSE,
        is_default BOOLEAN DEFAULT FALSE,
        is_free_default BOOLEAN DEFAULT FALSE,
        provider VARCHAR(20) DEFAULT 'openrouter',
        model VARCHAR(255) NOT NULL,
        vision_model VARCHAR(255),
        temperature DECIMAL(3, 2),
        top_p DECIMAL(3, 2),
        top_k INTEGER,
        frequency_penalty DECIMAL(3, 2),
        presence_penalty DECIMAL(3, 2),
        repetition_penalty DECIMAL(3, 2),
        max_tokens INTEGER,
        memory_score_threshold DECIMAL(3, 2),
        memory_limit INTEGER,
        context_window_tokens INTEGER DEFAULT 131072,
        advanced_parameters JSONB,
        max_referenced_messages INTEGER DEFAULT 20,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS personalities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        slug VARCHAR(255) UNIQUE NOT NULL,
        system_prompt_id UUID REFERENCES system_prompts(id),
        owner_id UUID,
        character_info TEXT NOT NULL,
        personality_traits TEXT NOT NULL,
        personality_tone TEXT,
        personality_age TEXT,
        personality_appearance TEXT,
        personality_likes TEXT,
        personality_dislikes TEXT,
        conversational_goals TEXT,
        conversational_examples TEXT,
        custom_fields JSONB,
        voice_enabled BOOLEAN DEFAULT FALSE,
        voice_settings JSONB,
        image_enabled BOOLEAN DEFAULT FALSE,
        image_settings JSONB,
        avatar_data BYTEA,
        error_message TEXT,
        birth_month INTEGER,
        birth_day INTEGER,
        birth_year INTEGER,
        is_public BOOLEAN DEFAULT TRUE,
        supports_extended_context BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS job_results (
        job_id VARCHAR(255) PRIMARY KEY,
        request_id VARCHAR(255) NOT NULL,
        result JSONB NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        delivered_at TIMESTAMP
      )
    `);

    // Seed test data
    const systemPrompt = await prisma.systemPrompt.create({
      data: {
        name: 'test-component-prompt',
        content: 'You are a test assistant for component testing.',
      },
    });

    await prisma.personality.create({
      data: {
        name: 'TestComponent',
        slug: 'test-component',
        displayName: 'Test Component Bot',
        systemPromptId: systemPrompt.id,
        characterInfo: 'A test bot for component testing',
        personalityTraits: 'Helpful and deterministic',
      },
    });

    // Create global default LLM config
    await prisma.llmConfig.create({
      data: {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Global Default',
        model: 'anthropic/claude-sonnet-4',
        visionModel: 'anthropic/claude-sonnet-4',
        temperature: 0.7,
        maxTokens: 4000,
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
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
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
      const result = await jobProcessor.processJob(mockJob);

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

    it('should process LLM job with conversation history', async () => {
      const requestId = 'test-component-llm-gen-2';
      const jobId = 'job-test-component-2';

      const jobData: LLMGenerationJobData = {
        requestId,
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'personality-test-id',
          name: 'TestComponent',
          displayName: 'Test Component Bot',
          slug: 'test-component',
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
        },
        message: 'What did I say earlier?',
        context: {
          userId: 'user-test-123',
          conversationHistory: [
            {
              role: MessageRole.User,
              content: 'Hello!',
              createdAt: new Date(Date.now() - 60000).toISOString(),
            },
            {
              role: MessageRole.Assistant,
              content: 'Hi there!',
              createdAt: new Date(Date.now() - 30000).toISOString(),
            },
          ],
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
      const result = await jobProcessor.processJob(mockJob);

      // Verify RAG service was called with conversation history
      expect(mockRagService.generateResponse).toHaveBeenCalledTimes(1);
      const generateCall = vi.mocked(mockRagService.generateResponse).mock.calls[0];

      // Check the context parameter (3rd argument)
      const contextArg = generateCall[2];
      expect(contextArg?.conversationHistory).toBeDefined();
      expect(contextArg?.conversationHistory?.length).toBe(2);

      // Verify conversation history was passed through
      expect(contextArg?.rawConversationHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: MessageRole.User,
            content: 'Hello!',
          }),
          expect.objectContaining({
            role: MessageRole.Assistant,
            content: 'Hi there!',
          }),
        ])
      );

      // Verify result was persisted
      const persistedResult = await prisma.jobResult.findUnique({
        where: { jobId },
      });

      expect(persistedResult).toBeDefined();
      expect(persistedResult?.requestId).toBe(requestId);
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
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
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
      const result = await jobProcessor.processJob(mockJob);

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
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
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
          systemPrompt: 'You are a test assistant',
          model: 'anthropic/claude-sonnet-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful',
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
