/**
 * Tests for LongTermMemoryService
 *
 * Tests long-term memory storage with pgvector integration,
 * pending memory fallback, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LongTermMemoryService } from './LongTermMemoryService.js';
import type { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { ConversationContext } from './ConversationalRAGService.js';

// Mock Prisma client
const mockPendingMemoryCreate = vi.fn();
const mockPendingMemoryDelete = vi.fn();
const mockPendingMemoryUpdate = vi.fn();

const mockPrismaClient = {
  pendingMemory: {
    create: mockPendingMemoryCreate,
    delete: mockPendingMemoryDelete,
    update: mockPendingMemoryUpdate,
  },
};

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
    getPrismaClient: () => mockPrismaClient,
  };
});

describe('LongTermMemoryService', () => {
  let service: LongTermMemoryService;
  let mockMemoryManager: PgvectorMemoryAdapter;

  const testPersonality: LoadedPersonality = {
    id: 'personality-1',
    slug: 'test-bot',
    name: 'TestBot',
    systemPrompt: 'You are a test bot',
    characterInfo: 'Test character',
    personalityTraits: 'Helpful',
    displayName: 'Test Bot',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 8000,
  };

  const baseContext: ConversationContext = {
    userId: 'user-1',
    channelId: 'channel-1',
    serverId: 'server-1',
  };

  beforeEach(() => {
    // Create mock memory manager
    mockMemoryManager = {
      addMemory: vi.fn().mockResolvedValue(undefined),
    } as unknown as PgvectorMemoryAdapter;

    // Reset all mocks
    vi.clearAllMocks();
    mockPendingMemoryCreate.mockResolvedValue({ id: 'pending-1' });
    mockPendingMemoryDelete.mockResolvedValue(undefined);
    mockPendingMemoryUpdate.mockResolvedValue(undefined);

    service = new LongTermMemoryService(mockMemoryManager);
  });

  describe('constructor', () => {
    it('should accept memory manager', () => {
      const serviceWithManager = new LongTermMemoryService(mockMemoryManager);
      expect(serviceWithManager).toBeInstanceOf(LongTermMemoryService);
    });

    it('should work without memory manager', () => {
      const serviceWithoutManager = new LongTermMemoryService();
      expect(serviceWithoutManager).toBeInstanceOf(LongTermMemoryService);
    });
  });

  describe('storeInteraction', () => {
    it('should return early when memory manager is undefined', async () => {
      const serviceWithoutManager = new LongTermMemoryService();

      await serviceWithoutManager.storeInteraction(
        testPersonality,
        'User message',
        'AI response',
        baseContext,
        'persona-1'
      );

      // Should not create pending memory or attempt storage
      expect(mockPendingMemoryCreate).not.toHaveBeenCalled();
    });

    it('should successfully store interaction to vector database', async () => {
      await service.storeInteraction(
        testPersonality,
        'Hello',
        'Hi there!',
        baseContext,
        'persona-1'
      );

      // Should create pending memory
      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          personaId: 'persona-1',
          personalityId: 'personality-1',
          text: '{user}: Hello\n{assistant}: Hi there!',
          attempts: 0,
        }),
      });

      // Should store to vector database
      expect(mockMemoryManager.addMemory).toHaveBeenCalledWith({
        text: '{user}: Hello\n{assistant}: Hi there!',
        metadata: expect.objectContaining({
          personaId: 'persona-1',
          personalityId: 'personality-1',
          summaryType: 'conversation',
        }),
      });

      // Should delete pending memory on success
      expect(mockPendingMemoryDelete).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
      });
    });

    it('should use personal canonScope when no sessionId', async () => {
      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        baseContext,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            canonScope: 'personal',
          }),
        }),
      });
    });

    it('should use session canonScope when sessionId present', async () => {
      const contextWithSession = {
        ...baseContext,
        sessionId: 'session-1',
      };

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        contextWithSession,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            canonScope: 'session',
            sessionId: 'session-1',
          }),
        }),
      });
    });

    it('should use dm contextType when no channelId', async () => {
      const dmContext: ConversationContext = {
        userId: 'user-1',
      };

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        dmContext,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            contextType: 'dm',
          }),
        }),
      });
    });

    it('should use channel contextType when channelId present', async () => {
      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        baseContext,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            contextType: 'channel',
            channelId: 'channel-1',
          }),
        }),
      });
    });

    it('should include serverId and guildId in metadata', async () => {
      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        baseContext,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            serverId: 'server-1',
            guildId: 'server-1',
          }),
        }),
      });
    });

    it('should format interaction text with user/assistant tokens', async () => {
      await service.storeInteraction(
        testPersonality,
        'What is the weather?',
        'It is sunny today.',
        baseContext,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          text: '{user}: What is the weather?\n{assistant}: It is sunny today.',
        }),
      });
    });

    it('should update pending memory on vector storage failure', async () => {
      const storageError = new Error('Vector storage failed');
      mockMemoryManager.addMemory = vi.fn().mockRejectedValue(storageError);

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        baseContext,
        'persona-1'
      );

      // Should create pending memory
      expect(mockPendingMemoryCreate).toHaveBeenCalled();

      // Should NOT delete pending memory
      expect(mockPendingMemoryDelete).not.toHaveBeenCalled();

      // Should update pending memory with error
      expect(mockPendingMemoryUpdate).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
        data: {
          attempts: { increment: 1 },
          lastAttemptAt: expect.any(Date),
          error: 'Vector storage failed',
        },
      });
    });

    it('should handle non-Error objects in failure', async () => {
      mockMemoryManager.addMemory = vi.fn().mockRejectedValue('String error');

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        baseContext,
        'persona-1'
      );

      expect(mockPendingMemoryUpdate).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
        data: expect.objectContaining({
          error: 'String error',
        }),
      });
    });

    it('should not throw when vector storage fails', async () => {
      mockMemoryManager.addMemory = vi.fn().mockRejectedValue(new Error('Storage failed'));

      // Should not throw
      await expect(
        service.storeInteraction(testPersonality, 'Message', 'Response', baseContext, 'persona-1')
      ).resolves.not.toThrow();
    });

    it('should handle pending memory update failure gracefully', async () => {
      mockMemoryManager.addMemory = vi.fn().mockRejectedValue(new Error('Storage failed'));
      mockPendingMemoryUpdate.mockRejectedValue(new Error('Update failed'));

      // Should not throw even when both storage and update fail
      await expect(
        service.storeInteraction(testPersonality, 'Message', 'Response', baseContext, 'persona-1')
      ).resolves.not.toThrow();
    });

    it('should include timestamp in metadata', async () => {
      const beforeTime = Date.now();

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        baseContext,
        'persona-1'
      );

      const afterTime = Date.now();

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            createdAt: expect.any(Number),
          }),
        }),
      });

      // Verify timestamp is reasonable
      const callArgs = mockPendingMemoryCreate.mock.calls[0][0];
      const createdAt = callArgs.data.metadata.createdAt;
      expect(createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(createdAt).toBeLessThanOrEqual(afterTime);
    });

    it('should handle empty sessionId as missing', async () => {
      const contextWithEmptySession = {
        ...baseContext,
        sessionId: '',
      };

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        contextWithEmptySession,
        'persona-1'
      );

      // Empty sessionId should be treated as personal, not session
      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            canonScope: 'personal',
          }),
        }),
      });
    });

    it('should handle empty channelId as DM', async () => {
      const contextWithEmptyChannel = {
        ...baseContext,
        channelId: '',
      };

      await service.storeInteraction(
        testPersonality,
        'Message',
        'Response',
        contextWithEmptyChannel,
        'persona-1'
      );

      expect(mockPendingMemoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            contextType: 'dm',
          }),
        }),
      });
    });
  });
});
