/**
 * Tests for GatewayClient
 *
 * Tests HTTP client for API Gateway interactions:
 * - AI generation job submission
 * - Voice transcription
 * - Delivery confirmation
 * - Health checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayClient } from './GatewayClient.js';
import { JobStatus } from '@tzurot/common-types';
import type { LoadedPersonality, MessageContext } from '../types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock dependencies
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
    getConfig: () => ({
      GATEWAY_URL: 'http://gateway-test.local',
    }),
  };
});

describe('GatewayClient', () => {
  let client: GatewayClient;

  const testPersonality: LoadedPersonality = {
    id: 'personality-1',
    slug: 'test-bot',
    name: 'TestBot',
    systemPrompt: 'You are a test bot',
    characterInfo: 'Test character',
    personalityTraits: 'Helpful',
    displayName: 'Test Bot',
    ownerId: 'owner-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const testContext: MessageContext = {
    messageContent: 'Hello world',
    conversationId: 'conv-1',
    discordUserId: 'user-1',
    channelId: 'channel-1',
    conversationHistory: [
      {
        role: 'user',
        content: 'Previous message',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GatewayClient();
  });

  describe('constructor', () => {
    it('should use provided baseUrl', () => {
      const customClient = new GatewayClient('http://custom.local');
      expect(customClient).toBeInstanceOf(GatewayClient);
    });

    it('should use config baseUrl when not provided', () => {
      const defaultClient = new GatewayClient();
      expect(defaultClient).toBeInstanceOf(GatewayClient);
    });
  });

  describe('generate', () => {
    it('should submit AI generation job successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-123',
          requestId: 'req-456',
          status: JobStatus.Queued,
        }),
      });

      const result = await client.generate(testPersonality, testContext);

      expect(result).toEqual({
        jobId: 'job-123',
        requestId: 'req-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://gateway-test.local/ai/generate',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.any(String),
        })
      );

      // Verify request body structure
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toMatchObject({
        personality: {
          id: testPersonality.id,
          slug: testPersonality.slug,
          name: testPersonality.name,
        },
        message: 'Hello world',
        context: expect.objectContaining({
          conversationId: 'conv-1',
          discordUserId: 'user-1',
          conversationHistory: expect.any(Array),
        }),
      });
    });

    it('should default conversationHistory to empty array if undefined', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-123',
          requestId: 'req-456',
          status: JobStatus.Queued,
        }),
      });

      const contextWithoutHistory: MessageContext = {
        messageContent: 'Test',
        conversationId: 'conv-1',
        discordUserId: 'user-1',
        channelId: 'channel-1',
      };

      await client.generate(testPersonality, contextWithoutHistory);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.context.conversationHistory).toEqual([]);
    });

    it('should include referenced messages in context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-123',
          requestId: 'req-456',
          status: JobStatus.Queued,
        }),
      });

      const contextWithReferences: MessageContext = {
        ...testContext,
        referencedMessages: [
          {
            referenceNumber: 1,
            discordMessageId: 'msg-1',
            content: 'Referenced message',
            authorUsername: 'Alice',
            authorDisplayName: 'Alice',
            timestamp: new Date().toISOString(),
            locationContext: 'Server: Test',
          },
        ],
      };

      await client.generate(testPersonality, contextWithReferences);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.context.referencedMessages).toBeDefined();
      expect(requestBody.context.referencedMessages).toHaveLength(1);
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.generate(testPersonality, testContext)).rejects.toThrow(
        'Gateway request failed: 500 Internal Server Error'
      );
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(client.generate(testPersonality, testContext)).rejects.toThrow('Network error');
    });

    it('should set 10s timeout for request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-123',
          requestId: 'req-456',
          status: JobStatus.Queued,
        }),
      });

      await client.generate(testPersonality, testContext);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeDefined();
    });
  });

  describe('transcribe', () => {
    const testAttachments = [
      {
        url: 'https://cdn.discord.com/audio.ogg',
        contentType: 'audio/ogg',
        name: 'voice-message.ogg',
        size: 12345,
        isVoiceMessage: true,
        duration: 5.2,
      },
    ];

    it('should transcribe audio successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-transcribe-1',
          status: JobStatus.Completed,
          result: {
            content: 'This is the transcription',
            metadata: {
              processingTimeMs: 1234,
            },
          },
        }),
      });

      const result = await client.transcribe(testAttachments);

      expect(result).toEqual({
        content: 'This is the transcription',
        metadata: {
          processingTimeMs: 1234,
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://gateway-test.local/ai/transcribe?wait=true',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should throw when transcription job is not completed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-transcribe-1',
          status: JobStatus.Failed,
          result: null,
        }),
      });

      await expect(client.transcribe(testAttachments)).rejects.toThrow(
        'Transcription job job-transcribe-1 status: failed'
      );
    });

    it('should throw when transcript content is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-transcribe-1',
          status: JobStatus.Completed,
          result: {
            content: '',
            metadata: {},
          },
        }),
      });

      await expect(client.transcribe(testAttachments)).rejects.toThrow(
        'No transcript in job result'
      );
    });

    it('should throw when result is null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-transcribe-1',
          status: JobStatus.Completed,
          result: null,
        }),
      });

      await expect(client.transcribe(testAttachments)).rejects.toThrow(
        'No transcript in job result'
      );
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(client.transcribe(testAttachments)).rejects.toThrow(
        'Transcription request failed: 400 Bad Request'
      );
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      await expect(client.transcribe(testAttachments)).rejects.toThrow('Network failure');
    });

    it('should send attachments in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jobId: 'job-1',
          status: JobStatus.Completed,
          result: { content: 'test' },
        }),
      });

      await client.transcribe(testAttachments);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.attachments).toEqual(testAttachments);
    });
  });

  describe('confirmDelivery', () => {
    it('should confirm delivery successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      });

      await expect(client.confirmDelivery('job-123')).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://gateway-test.local/ai/job/job-123/confirm-delivery',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should not throw on confirmation failure (best-effort)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      // Should not throw
      await expect(client.confirmDelivery('job-123')).resolves.not.toThrow();
    });

    it('should not throw on network error (best-effort)', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(client.confirmDelivery('job-123')).resolves.not.toThrow();
    });

    it('should set 5s timeout for request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      });

      await client.confirmDelivery('job-123');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should return true when gateway is healthy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://gateway-test.local/health');
    });

    it('should return false when gateway is unhealthy', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });
});
