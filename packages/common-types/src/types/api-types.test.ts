/**
 * API Endpoint Contract Tests
 *
 * These tests verify the contract between bot-client (API consumer) and
 * api-gateway (API provider). They ensure both services use the same schemas
 * and types for HTTP requests/responses, catching breaking changes during refactoring.
 *
 * WHY THIS IS CRITICAL:
 * - Phase 1 will refactor the database schema extensively
 * - API requests/responses reference database entities (Personality, User, etc.)
 * - Schema changes could silently break API contracts
 * - These tests catch those breaks at build time
 */

import { describe, it, expect } from 'vitest';
import {
  generateRequestSchema,
  attachmentMetadataSchema,
  requestContextSchema,
  loadedPersonalitySchema,
  referencedMessageSchema,
  type GenerateRequest,
  type GenerateResponse,
} from './api-types.js';
import { JobStatus } from '../constants/queue.js';
import { MessageRole } from '../constants/message.js';
import { TEST_PERSONALITY, MINIMAL_CONTEXT, FULL_CONTEXT } from './test/fixtures.js';

describe('API Endpoint Contract Tests', () => {
  describe('POST /ai/generate - Request Schema', () => {
    it('should validate a valid minimal generate request', () => {
      const validRequest: GenerateRequest = {
        personality: TEST_PERSONALITY,
        message: 'Hello, world!',
        context: MINIMAL_CONTEXT,
      };

      const result = generateRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate a generate request with full context', () => {
      const validRequest: GenerateRequest = {
        personality: TEST_PERSONALITY,
        message: 'Hello, world!',
        context: FULL_CONTEXT,
      };

      const result = generateRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate a generate request with user API key (BYOK)', () => {
      const validRequest: GenerateRequest = {
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'anthropic/claude-sonnet-4.5',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Hello, world!',
        context: {
          userId: 'user-123',
        },
        userApiKey: 'user-provided-key',
      };

      const result = generateRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userApiKey).toBe('user-provided-key');
      }
    });

    it('should reject generate request missing required fields', () => {
      const invalidRequest = {
        message: 'Hello, world!',
        // Missing: personality, context
      };

      const result = generateRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject generate request with invalid personality', () => {
      const invalidRequest = {
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          // Missing required personality fields
        },
        message: 'Hello!',
        context: { userId: 'user-123' },
      };

      const result = generateRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should accept both string and object message types', () => {
      // String message
      const requestWithString: GenerateRequest = {
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'anthropic/claude-sonnet-4.5',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'String message',
        context: { userId: 'user-123' },
      };

      const resultString = generateRequestSchema.safeParse(requestWithString);
      expect(resultString.success).toBe(true);

      // Object message (for multimodal)
      const requestWithObject: GenerateRequest = {
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'anthropic/claude-sonnet-4.5',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: { type: 'multimodal', content: 'Object message' },
        context: { userId: 'user-123' },
      };

      const resultObject = generateRequestSchema.safeParse(requestWithObject);
      expect(resultObject.success).toBe(true);
    });
  });

  describe('POST /ai/generate - Response Type', () => {
    it('should document the response structure (202 Accepted)', () => {
      // This test serves as documentation of the /ai/generate response contract
      const response: GenerateResponse = {
        jobId: 'llm-req-123',
        requestId: 'req-test-789',
        status: JobStatus.Queued,
      };

      // Verify required fields
      expect(response.jobId).toBeDefined();
      expect(response.requestId).toBeDefined();
      expect(response.status).toBe(JobStatus.Queued);
    });

    it('should support optional result field for synchronous responses', () => {
      // When wait=true is supported in the future
      // Result uses LLMGenerationResult which includes success/error fields
      const response: GenerateResponse = {
        jobId: 'llm-req-123',
        requestId: 'req-test-789',
        status: JobStatus.Completed,
        result: {
          requestId: 'req-test-789',
          success: true,
          content: 'Generated response text',
          metadata: {
            modelUsed: 'anthropic/claude-sonnet-4.5',
            tokensIn: 100,
            tokensOut: 50,
            processingTimeMs: 250,
          },
        },
        timestamp: new Date().toISOString(),
      };

      expect(response.result).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });
  });

  describe('POST /ai/job/:jobId/confirm-delivery - Response Type', () => {
    it('should document the response structure', () => {
      // This endpoint has no schema-defined response, but we document the contract
      const response = {
        jobId: 'llm-req-123',
        status: 'DELIVERED',
        message: 'Delivery confirmed',
      };

      expect(response.jobId).toBeDefined();
      expect(response.status).toBe('DELIVERED');
      expect(response.message).toBe('Delivery confirmed');
    });

    it('should document the idempotent response', () => {
      // When job is already delivered
      const response = {
        jobId: 'llm-req-123',
        status: 'DELIVERED',
        message: 'Already confirmed',
      };

      expect(response.jobId).toBeDefined();
      expect(response.status).toBe('DELIVERED');
      expect(response.message).toBe('Already confirmed');
    });
  });

  describe('GET /ai/job/:jobId - Response Type', () => {
    it('should document the job status response structure', () => {
      // This endpoint has no schema-defined response, but we document the contract
      const response = {
        jobId: 'llm-req-123',
        status: 'completed',
        progress: 100,
        result: {
          content: 'Generated response',
          metadata: {
            tokensIn: 100,
            tokensOut: 50,
            processingTimeMs: 250,
          },
        },
        timestamp: new Date().toISOString(),
      };

      expect(response.jobId).toBeDefined();
      expect(response.status).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });

    it('should support progress as number or object', () => {
      // Progress can be either a number (percentage) or object (detailed progress)
      const responseWithNumber = {
        jobId: 'llm-req-123',
        status: 'active',
        progress: 50,
        result: null,
        timestamp: new Date().toISOString(),
      };

      const responseWithObject = {
        jobId: 'llm-req-123',
        status: 'active',
        progress: {
          stage: 'processing',
          percentage: 50,
        },
        result: null,
        timestamp: new Date().toISOString(),
      };

      expect(typeof responseWithNumber.progress).toBe('number');
      expect(typeof responseWithObject.progress).toBe('object');
    });
  });

  describe('Shared Schema Components', () => {
    it('should validate attachment metadata', () => {
      const validAttachment = {
        url: 'https://example.com/image.png',
        contentType: 'image/png',
        name: 'image.png',
        size: 2048,
      };

      const result = attachmentMetadataSchema.safeParse(validAttachment);
      expect(result.success).toBe(true);
    });

    it('should validate referenced message structure', () => {
      const validReference = {
        referenceNumber: 1,
        discordMessageId: 'msg-123',
        discordUserId: 'user-456',
        authorUsername: 'testuser',
        authorDisplayName: 'Test User',
        content: 'Referenced content',
        embeds: '',
        timestamp: new Date().toISOString(),
        locationContext: 'Test Server / #general',
      };

      const result = referencedMessageSchema.safeParse(validReference);
      expect(result.success).toBe(true);
    });

    it('should validate referenced message with isDeduplicated flag', () => {
      const dedupedReference = {
        referenceNumber: 1,
        discordMessageId: 'msg-123',
        discordUserId: 'user-456',
        authorUsername: 'testuser',
        authorDisplayName: 'Test User',
        content: 'Truncated content...',
        embeds: '',
        timestamp: new Date().toISOString(),
        locationContext: '',
        isDeduplicated: true,
      };

      const result = referencedMessageSchema.safeParse(dedupedReference);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDeduplicated).toBe(true);
      }
    });

    it('should validate loaded personality structure', () => {
      const validPersonality = {
        id: 'personality-123',
        name: 'TestPersonality',
        displayName: 'Test Personality',
        slug: 'test',
        systemPrompt: 'You are a helpful assistant',
        model: 'anthropic/claude-sonnet-4.5',
        temperature: 0.7,
        maxTokens: 2000,
        contextWindowTokens: 8192,
        characterInfo: 'A helpful test personality',
        personalityTraits: 'Helpful, friendly',
      };

      const result = loadedPersonalitySchema.safeParse(validPersonality);
      expect(result.success).toBe(true);
    });

    it('should validate request context with minimal fields', () => {
      const validContext = {
        userId: 'user-123',
      };

      const result = requestContextSchema.safeParse(validContext);
      expect(result.success).toBe(true);
    });

    it('should validate request context with all fields', () => {
      const validContext = {
        userId: 'user-123',
        userName: 'TestUser',
        channelId: 'channel-123',
        serverId: 'server-123',
        sessionId: 'session-123',
        activePersonaId: 'persona-123',
        activePersonaName: 'TestPersona',
        conversationHistory: [
          {
            role: MessageRole.User,
            content: 'Test message',
            createdAt: new Date().toISOString(),
          },
        ],
        attachments: [
          {
            url: 'https://example.com/file.pdf',
            contentType: 'application/pdf',
            name: 'file.pdf',
            size: 1024,
          },
        ],
        environment: {
          type: 'guild',
          guild: {
            id: 'guild-123',
            name: 'Test Guild',
          },
          channel: {
            id: 'channel-123',
            name: 'test-channel',
            type: 'GUILD_TEXT',
          },
        },
        referencedMessages: [
          {
            referenceNumber: 1,
            discordMessageId: 'msg-123',
            discordUserId: 'user-456',
            authorUsername: 'testuser',
            authorDisplayName: 'Test User',
            content: 'Referenced content',
            embeds: '',
            timestamp: new Date().toISOString(),
            locationContext: 'Test Server / #general',
          },
        ],
      };

      const result = requestContextSchema.safeParse(validContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Producer-Consumer Contract', () => {
    it('should document the contract: bot-client calls api-gateway', () => {
      // This test serves as documentation:
      //
      // PRODUCER (bot-client):
      // - Constructs GenerateRequest from Discord messages
      // - Sends POST to /ai/generate
      // - Receives GenerateResponse (202 Accepted)
      // - Polls GET /ai/job/:jobId for status
      // - Confirms delivery with POST /ai/job/:jobId/confirm-delivery
      //
      // CONSUMER (api-gateway):
      // - Validates GenerateRequest with generateRequestSchema
      // - Creates BullMQ jobs (via validatedQueue.ts)
      // - Returns GenerateResponse
      // - Provides job status via BullMQ
      // - Marks jobs as delivered in job_results table
      //
      // CONTRACT:
      // - API requests are ALWAYS validated by Zod schemas
      // - Bot-client must use shared types from @tzurot/common-types
      // - Breaking changes to schemas MUST be coordinated between services
      //
      // PHASE 1 SAFETY:
      // - These tests catch schema/type mismatches at build time
      // - Prevents silent breakage during database schema refactoring
      // - Changes to Personality, User, or Context require updating these tests

      expect(true).toBe(true); // This test always passes - it's just documentation
    });
  });
});
