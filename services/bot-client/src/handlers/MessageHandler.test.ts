/**
 * Tests for MessageHandler
 *
 * Tests the Chain of Responsibility pattern for message processing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType } from 'discord.js';
import { MessageHandler } from './MessageHandler.js';
import { BotMessageFilter } from '../processors/BotMessageFilter.js';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import type { Message } from 'discord.js';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { DiscordResponseSender } from '../services/DiscordResponseSender.js';
import type { ConversationPersistence } from '../services/ConversationPersistence.js';
import type { JobTracker } from '../services/JobTracker.js';
import type { SlotDeliveryService } from '../services/SlotDeliveryService.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { MultiTagCoordinator } from '../services/MultiTagCoordinator.js';
import type { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';

// confirmDelivery + updateDiagnosticResponseIds moved off GatewayClient to the
// gatewayServiceCalls module; route them to a holder so the existing
// assertions keep working unchanged.
const mockGatewayClient = {
  updateDiagnosticResponseIds: vi.fn().mockResolvedValue(undefined),
  confirmDelivery: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: (...args: unknown[]) => mockGatewayClient.confirmDelivery(...args),
  updateDiagnosticResponseIds: (...args: unknown[]) =>
    mockGatewayClient.updateDiagnosticResponseIds(...args),
}));

const mockReportJobError = vi.fn();
const mockReportDeliveryFailure = vi.fn();
vi.mock('../observability/ErrorChannelReporter.js', () => ({
  reportJobError: (...args: unknown[]) => mockReportJobError(...args),
  reportDeliveryFailure: (...args: unknown[]) => mockReportDeliveryFailure(...args),
  // Mirrors the real implementation's no-op-when-absent shape, so existing
  // mockReportJobError assertions keep working unchanged for the
  // success-path quota-fallback seam.
  // KEPT IN SYNC BY HAND with reportQuotaFallbackRescue in
  // ErrorChannelReporter.ts — a behavior change there (deny-list routing,
  // rescue-category resolution) is NOT caught by this file's wiring tests,
  // only by ErrorChannelReporter.test.ts's direct tests. Exercising the real
  // chain here would need the reporter's module-level client + dedup caches
  // reset per test, which is more fragile than this hand-mirror.
  reportQuotaFallbackRescue: (
    result: { metadata?: { quotaFallback?: unknown } } | undefined,
    personalityName: string | undefined
  ) => {
    if (result?.metadata?.quotaFallback !== undefined) {
      mockReportJobError(result, personalityName);
    }
  },
}));

// Mock dependencies
const mockResponseSender = {
  sendResponse: vi.fn(),
};

const mockPersistence = {
  updateUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
  saveAssistantMessageFromFields: vi.fn().mockResolvedValue(undefined),
};

const mockJobTracker = {
  getContext: vi.fn(),
  completeJob: vi.fn(),
};

// Slot-delivery surface. Mocked directly (no threading-through): tests
// assert on `mockSlotDelivery.deliverSuccess` / `deliverError` calls
// rather than the inner persistence/sendResponse details, which are
// covered by SlotDeliveryService.test.ts.
const mockSlotDelivery = {
  deliverSuccess: vi.fn(),
  deliverError: vi.fn(),
};

// Multi-tag coordinator — default to "not owning" any job and "not stale" so
// existing single-personality tests flow through the original path.
// `staleCheckNeeded` defaults true so existing tests preserve their prior
// behavior of going through the isStale call; tests targeting the short-
// circuit explicitly flip `mockCoordinatorState.staleCheckNeeded = false`
// in their setup.
const mockCoordinatorState = { staleCheckNeeded: true };
const mockCoordinator = {
  ownsJob: vi.fn().mockReturnValue(false),
  isStale: vi.fn().mockResolvedValue(false),
  handleJobResult: vi.fn().mockResolvedValue(undefined),
  clearStale: vi.fn().mockResolvedValue(undefined),
  // Late-result recovery: default to "no marker" so unknown jobs drop as before.
  getSyntheticTimeout: vi.fn().mockResolvedValue(null),
  clearSyntheticTimeout: vi.fn().mockResolvedValue(undefined),
  get staleCheckNeeded() {
    return mockCoordinatorState.staleCheckNeeded;
  },
};

const mockPersonalityService = {
  loadPersonality: vi.fn().mockResolvedValue(null),
};

const mockClient = {
  channels: { fetch: vi.fn().mockResolvedValue(null) },
};

// Maintenance gate defaults OFF so the existing suite exercises the normal
// path; the maintenance tests flip the resolved value per-test.
const mockMaintenanceFlag = {
  isActive: vi.fn().mockResolvedValue(false),
};

describe('MessageHandler', () => {
  let messageHandler: MessageHandler;
  let mockProcessor1: IMessageProcessor;
  let mockProcessor2: IMessageProcessor;
  let mockProcessor3: IMessageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayClient.updateDiagnosticResponseIds.mockResolvedValue(undefined);
    mockCoordinatorState.staleCheckNeeded = true;

    // Create mock processors
    mockProcessor1 = {
      process: vi.fn().mockResolvedValue(false),
    };

    mockProcessor2 = {
      process: vi.fn().mockResolvedValue(false),
    };

    mockProcessor3 = {
      process: vi.fn().mockResolvedValue(false),
    };

    mockMaintenanceFlag.isActive.mockResolvedValue(false);

    messageHandler = new MessageHandler({
      processors: [mockProcessor1, mockProcessor2, mockProcessor3],
      responseSender: mockResponseSender as unknown as DiscordResponseSender,
      persistence: mockPersistence as unknown as ConversationPersistence,
      jobTracker: mockJobTracker as unknown as JobTracker,
      slotDelivery: mockSlotDelivery as unknown as SlotDeliveryService,
      coordinator: mockCoordinator as unknown as MultiTagCoordinator,
      personalityService: mockPersonalityService as unknown as IPersonalityLoader,
      client: mockClient as unknown as import('discord.js').Client,
      maintenanceFlag: mockMaintenanceFlag as unknown as MaintenanceFlag,
    });

    // Direct mocks — no threading-through. Tests assert on
    // mockSlotDelivery.{deliverSuccess,deliverError} directly. (For tests
    // targeting deliverError fallback / persistence behavior, override the
    // implementation per-test.)
    mockSlotDelivery.deliverSuccess.mockResolvedValue({ chunkMessageIds: ['m1', 'm2'] });
    mockSlotDelivery.deliverError.mockResolvedValue(undefined);
  });

  describe('handleMessage - Chain of Responsibility', () => {
    function createMockMessage(overrides = {}): Message {
      return {
        id: 'msg-123',
        type: MessageType.Default, // Required for system message filtering
        author: {
          tag: 'TestUser#1234',
          bot: false,
        },
        reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
        ...overrides,
      } as unknown as Message;
    }

    it('short-circuits the chain during a maintenance window (silent for non-mention guild messages)', async () => {
      mockMaintenanceFlag.isActive.mockResolvedValue(true);
      const message = createMockMessage({
        guild: {},
        client: { user: { id: 'bot-id' } },
        mentions: { has: vi.fn().mockReturnValue(false) },
      });

      await messageHandler.handleMessage(message);

      // Nothing reaches the processor chain — the whole point of the gate.
      expect(mockProcessor1.process).not.toHaveBeenCalled();
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('replies with the maintenance notice for DMs during a maintenance window', async () => {
      mockMaintenanceFlag.isActive.mockResolvedValue(true);
      const message = createMockMessage({ guild: null, client: { user: { id: 'bot-id' } } });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('maintenance'));
    });

    it('should pass message through processor chain in order', async () => {
      const message = createMockMessage();

      await messageHandler.handleMessage(message);

      // All processors should be called in order
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);
      expect(mockProcessor3.process).toHaveBeenCalledWith(message);

      // Verify order
      const calls = [
        vi.mocked(mockProcessor1.process).mock.invocationCallOrder[0],
        vi.mocked(mockProcessor2.process).mock.invocationCallOrder[0],
        vi.mocked(mockProcessor3.process).mock.invocationCallOrder[0],
      ];
      expect(calls[0]).toBeLessThan(calls[1]);
      expect(calls[1]).toBeLessThan(calls[2]);
    });

    it('should stop chain when a processor handles the message', async () => {
      const message = createMockMessage();

      // Second processor handles the message
      vi.mocked(mockProcessor2.process).mockResolvedValue(true);

      await messageHandler.handleMessage(message);

      // First and second processors called
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);

      // Third processor should NOT be called
      expect(mockProcessor3.process).not.toHaveBeenCalled();
    });

    it('should handle all processors when none handle the message', async () => {
      const message = createMockMessage();

      // All processors return false
      vi.mocked(mockProcessor1.process).mockResolvedValue(false);
      vi.mocked(mockProcessor2.process).mockResolvedValue(false);
      vi.mocked(mockProcessor3.process).mockResolvedValue(false);

      await messageHandler.handleMessage(message);

      // All processors should be called
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);
      expect(mockProcessor3.process).toHaveBeenCalledWith(message);
    });

    it('should handle errors gracefully and reply to user', async () => {
      const message = createMockMessage();

      // First processor throws an error
      vi.mocked(mockProcessor1.process).mockRejectedValue(new Error('Processor error'));

      await messageHandler.handleMessage(message);

      // Should send error reply to user
      expect(message.reply).toHaveBeenCalledWith(
        'Sorry, I encountered an error processing your message.'
      );
    });

    it('should not throw if error reply fails', async () => {
      const message = createMockMessage();

      vi.mocked(mockProcessor1.process).mockRejectedValue(new Error('Processor error'));
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Channel deleted'));

      // Should not throw
      await expect(messageHandler.handleMessage(message)).resolves.toBeUndefined();
    });

    it('should stop at first processor that handles the message', async () => {
      const message = createMockMessage();

      // First processor handles it
      vi.mocked(mockProcessor1.process).mockResolvedValue(true);

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).not.toHaveBeenCalled();
      expect(mockProcessor3.process).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - System Message Filtering', () => {
    function createMockMessage(overrides = {}): Message {
      return {
        id: 'msg-123',
        type: MessageType.Default,
        author: {
          tag: 'TestUser#1234',
          bot: false,
        },
        reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
        ...overrides,
      } as unknown as Message;
    }

    it('should ignore ThreadCreated system messages', async () => {
      const message = createMockMessage({ type: MessageType.ThreadCreated });

      await messageHandler.handleMessage(message);

      // No processors should be called for system messages
      expect(mockProcessor1.process).not.toHaveBeenCalled();
      expect(mockProcessor2.process).not.toHaveBeenCalled();
      expect(mockProcessor3.process).not.toHaveBeenCalled();
    });

    it('should ignore ChannelPinnedMessage system messages', async () => {
      const message = createMockMessage({ type: MessageType.ChannelPinnedMessage });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
    });

    it('should ignore UserJoin system messages', async () => {
      const message = createMockMessage({ type: MessageType.UserJoin });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
    });

    it('should ignore GuildBoost system messages', async () => {
      const message = createMockMessage({ type: MessageType.GuildBoost });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
    });

    it('should process Default messages normally', async () => {
      const message = createMockMessage({ type: MessageType.Default });

      await messageHandler.handleMessage(message);

      // Processors should be called for normal messages
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
    });

    it('should process Reply messages normally', async () => {
      const message = createMockMessage({ type: MessageType.Reply });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
    });
  });

  describe('handleMessage - trigger-path admission does not create new bot-reply triggers', () => {
    function createMockMessage(overrides = {}): Message {
      return {
        id: 'msg-123',
        type: MessageType.Default,
        author: {
          tag: 'TestUser#1234',
          bot: false,
        },
        reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
        ...overrides,
      } as unknown as Message;
    }

    it('admits a ChatInputCommand message past the type filter but stops it at BotMessageFilter (real, not mocked)', async () => {
      const spyProcessor: IMessageProcessor = {
        process: vi.fn().mockResolvedValue(false),
      };
      const realChainHandler = new MessageHandler({
        processors: [new BotMessageFilter(), spyProcessor],
        responseSender: mockResponseSender as unknown as DiscordResponseSender,
        persistence: mockPersistence as unknown as ConversationPersistence,
        jobTracker: mockJobTracker as unknown as JobTracker,
        slotDelivery: mockSlotDelivery as unknown as SlotDeliveryService,
        coordinator: mockCoordinator as unknown as MultiTagCoordinator,
        personalityService: mockPersonalityService as unknown as IPersonalityLoader,
        client: mockClient as unknown as import('discord.js').Client,
        maintenanceFlag: mockMaintenanceFlag as unknown as MaintenanceFlag,
      });

      const message = createMockMessage({
        type: MessageType.ChatInputCommand,
        author: { tag: 'OtherBot#0000', bot: true },
      });

      await realChainHandler.handleMessage(message);

      // Widening isUserContentMessage admits this type past the initial
      // system-message filter, but BotMessageFilter still stops it — no new
      // trigger surface for bot-authored command replies.
      expect(spyProcessor.process).not.toHaveBeenCalled();
    });

    it('companion: a non-bot Default message DOES reach the processor after BotMessageFilter', async () => {
      const spyProcessor: IMessageProcessor = {
        process: vi.fn().mockResolvedValue(false),
      };
      const realChainHandler = new MessageHandler({
        processors: [new BotMessageFilter(), spyProcessor],
        responseSender: mockResponseSender as unknown as DiscordResponseSender,
        persistence: mockPersistence as unknown as ConversationPersistence,
        jobTracker: mockJobTracker as unknown as JobTracker,
        slotDelivery: mockSlotDelivery as unknown as SlotDeliveryService,
        coordinator: mockCoordinator as unknown as MultiTagCoordinator,
        personalityService: mockPersonalityService as unknown as IPersonalityLoader,
        client: mockClient as unknown as import('discord.js').Client,
        maintenanceFlag: mockMaintenanceFlag as unknown as MaintenanceFlag,
      });

      const message = createMockMessage({
        type: MessageType.Default,
        author: { tag: 'TestUser#1234', bot: false },
      });

      await realChainHandler.handleMessage(message);

      expect(spyProcessor.process).toHaveBeenCalledWith(message);
    });
  });

  describe('handleJobResult - staleCheckNeeded fast-path', () => {
    it('skips the isStale Redis call when staleCheckNeeded is false', async () => {
      // Normal operation: no shutdown or recovery has marked any jobIds
      // stale, so the SET is empty. The fast-path flag short-circuits the
      // wasted Redis SISMEMBER on every regular single-personality result.
      mockCoordinatorState.staleCheckNeeded = false;
      mockJobTracker.getContext.mockReturnValue(null); // unknown job — bail before delivery

      const disposition = await messageHandler.handleJobResult('job-fast-path', {
        requestId: 'r1',
        success: true,
        content: 'whatever',
      });

      expect(disposition).toBe('dropped');
      expect(mockCoordinator.isStale).not.toHaveBeenCalled();
    });

    it('runs the isStale check when staleCheckNeeded is true', async () => {
      mockCoordinatorState.staleCheckNeeded = true;
      mockJobTracker.getContext.mockReturnValue(null);

      const disposition = await messageHandler.handleJobResult('job-with-check', {
        requestId: 'r1',
        success: true,
        content: 'whatever',
      });

      expect(disposition).toBe('dropped');
      expect(mockCoordinator.isStale).toHaveBeenCalledWith('job-with-check');
    });
  });

  describe('handleJobResult - coordinator-owned and stale branches', () => {
    it('multi-tag ownsJob fast-path reports `delivered`', async () => {
      // The coordinator delivers the group's reply and owns its own
      // confirmation, so the caller must not record this as a loss.
      // `mockReturnValueOnce` (not `mockReturnValue`) — `vi.clearAllMocks()`
      // in `beforeEach` clears call history but NOT a persistent
      // implementation, and nothing else in this suite resets `ownsJob`
      // back to false, so a persistent `true` here would leak into every
      // later test.
      mockCoordinator.ownsJob.mockReturnValueOnce(true);

      const disposition = await messageHandler.handleJobResult('job-multitag', {
        requestId: 'req-multitag',
        success: true,
        content: 'group slot content',
      } as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockCoordinator.handleJobResult).toHaveBeenCalledWith(
        'job-multitag',
        expect.objectContaining({ requestId: 'req-multitag' })
      );
      // The fast path must not fall through to the single-personality lookup.
      expect(mockJobTracker.getContext).not.toHaveBeenCalled();
    });

    it('stale-discard path reports `delivered`', async () => {
      // The system consciously gave this job up during a prior shutdown and
      // the row must be reclaimable — it is a deliberate policy resolution,
      // not a silent loss.
      mockCoordinatorState.staleCheckNeeded = true;
      // Once-variants for the same leak reason as the sibling test above —
      // a persistent `true` on `isStale` would route every later test
      // through the stale-discard branch instead of its intended path.
      mockCoordinator.ownsJob.mockReturnValueOnce(false);
      mockCoordinator.isStale.mockResolvedValueOnce(true);

      const disposition = await messageHandler.handleJobResult('job-stale', {
        requestId: 'req-stale',
        success: true,
        content: 'result for a pre-restart job',
      } as LLMGenerationResult);

      expect(disposition).toBe('delivered');

      // Both side effects are fire-and-forget.
      await new Promise(resolve => setImmediate(resolve));

      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledWith('job-stale');
      expect(mockCoordinator.clearStale).toHaveBeenCalledWith('job-stale');
    });
  });

  describe('handleJobResult - Async Job Completion', () => {
    it('should handle successful job result and update/save messages', async () => {
      const jobId = 'job-123';
      const result = {
        requestId: 'req-123',
        success: true,
        content: 'AI response text',
        attachmentDescriptions: '[Image: cat.jpg]\nA cute cat',
        referencedMessagesDescriptions: '[Previous message context]',
        metadata: {
          modelUsed: 'anthropic/claude-sonnet-4.5',
        },
      };

      const mockMessage = {
        id: 'msg-123',
        author: { id: 'user-recipient' },
      } as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'personality-123', name: 'TestBot' },
        personaId: 'persona-456',
        userMessageContent: 'User message',
        userMessageTime: new Date('2025-11-14T12:00:00Z'),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockSlotDelivery.deliverSuccess.mockResolvedValue({
        chunkMessageIds: ['discord-1', 'discord-2'],
      });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');

      // Should get job context
      expect(mockJobTracker.getContext).toHaveBeenCalledWith(jobId);

      // Should complete the job (clear typing, remove from tracker)
      expect(mockJobTracker.completeJob).toHaveBeenCalledWith(jobId);

      // Should hand off to SlotDeliveryService with the right slot + result.
      // (Inner persistence/sendResponse details are covered by
      // SlotDeliveryService.test.ts; MessageHandler is the dispatch layer.)
      expect(mockSlotDelivery.deliverSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'AI response text',
          attachmentDescriptions: '[Image: cat.jpg]\nA cute cat',
        }),
        expect.objectContaining({
          personality: mockContext.personality,
          personaId: 'persona-456',
          channel: mockContext.channel,
          guildId: mockContext.guildId,
          clientId: mockContext.clientId,
          message: mockMessage,
          userMessageTime: mockContext.userMessageTime,
        })
      );
    });

    it('should ignore results for unknown jobs', async () => {
      const jobId = 'unknown-job';
      const result = {
        requestId: 'req-unknown',
        success: true,
        content: 'Some content',
      } as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue(null);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('dropped');

      // Should not call any other methods
      expect(mockJobTracker.completeJob).not.toHaveBeenCalled();
      expect(mockSlotDelivery.deliverSuccess).not.toHaveBeenCalled();
      expect(mockSlotDelivery.deliverError).not.toHaveBeenCalled();
    });

    it('reports a dropped result as `dropped` and never confirms its delivery', async () => {
      // The gap that let TASK-821 ship: the test above proved nothing was
      // DELIVERED but said nothing about what was RECORDED, so the caller was
      // free to mark a silently-dropped reply as delivered.
      const jobId = 'unknown-job-disposition';
      const result = {
        requestId: 'req-unknown-disposition',
        success: true,
        content: 'A reply nobody will ever see',
      } as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue(null);
      // No synthetic-timeout marker — this is a genuinely unknown job.
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(null);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('dropped');
      expect(mockGatewayClient.confirmDelivery).not.toHaveBeenCalled();
    });

    it('reports a delivered message result as `delivered`', async () => {
      // The other half of the contract: the caller confirms on this value, so
      // a wrong `dropped` here would strand every healthy job's gateway row.
      const jobId = 'known-job-disposition';
      const result = {
        requestId: 'req-known-disposition',
        success: true,
        content: 'Delivered content',
      } as LLMGenerationResult;

      // Self-contained per Core Principle 6 — this block builds its own context.
      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'personality-123', name: 'TestBot' },
        personaId: 'persona-456',
        userMessageContent: 'User message',
        userMessageTime: new Date('2025-11-14T12:00:00Z'),
      });
      mockSlotDelivery.deliverSuccess.mockResolvedValue({ chunkMessageIds: ['discord-1'] });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
    });
  });

  describe('handleJobResult - late-result recovery (synthetic-timeout marker)', () => {
    const recoveryCtx = {
      channelId: 'channel-late',
      guildId: 'guild-1',
      clientId: 'bot-1',
      personalitySlug: 'lila',
      recipientUserId: 'user-1',
      isAutoResponse: false,
    };
    const lateResult = {
      requestId: 'req-late',
      success: true,
      content: 'The real reply that arrived late',
      metadata: { modelUsed: 'anthropic/claude-sonnet-4' },
    } as LLMGenerationResult;

    beforeEach(() => {
      mockJobTracker.getContext.mockReturnValue(null); // not tracked → recovery path
    });

    it('delivers a late successful result as a follow-up, then confirms + clears', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(recoveryCtx);
      mockPersonalityService.loadPersonality.mockResolvedValue({
        id: 'p-lila',
        name: 'lila',
        slug: 'lila',
        displayName: 'Lila',
      });
      mockClient.channels.fetch.mockResolvedValue({
        id: 'channel-late',
        isTextBased: () => true,
        isThread: () => false,
        type: 0, // GuildText — passes isTypingChannel
      });
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m1'] });

      const disposition = await messageHandler.handleJobResult('job-late', lateResult);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      const opts = mockResponseSender.sendResponse.mock.calls[0][0];
      expect(opts.content).toContain('took longer than expected');
      expect(opts.content).toContain('The real reply that arrived late');
      expect(opts.personality.slug).toBe('lila');
      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledWith('job-late');
      expect(mockCoordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-late');
    });

    it('clears the marker without a second message when the late result failed', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(recoveryCtx);
      const failedLate = {
        requestId: 'req-late',
        success: false,
        error: 'boom',
      } as LLMGenerationResult;

      const disposition = await messageHandler.handleJobResult('job-late', failedLate);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).not.toHaveBeenCalled();
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledWith('job-late');
      expect(mockCoordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-late');
    });

    it('clears the marker (no follow-up) when the personality is no longer loadable', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(recoveryCtx);
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const disposition = await messageHandler.handleJobResult('job-late', lateResult);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).not.toHaveBeenCalled();
      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledWith('job-late');
      expect(mockCoordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-late');
    });

    it('clears the marker (no follow-up) when the channel is no longer fetchable', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(recoveryCtx);
      mockPersonalityService.loadPersonality.mockResolvedValue({
        id: 'p-lila',
        name: 'lila',
        slug: 'lila',
        displayName: 'Lila',
      });
      mockClient.channels.fetch.mockResolvedValue(null); // channel deleted/inaccessible

      const disposition = await messageHandler.handleJobResult('job-late', lateResult);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).not.toHaveBeenCalled();
      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledWith('job-late');
      expect(mockCoordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-late');
    });

    it('drops normally (no recovery) when there is no marker', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(null);

      const disposition = await messageHandler.handleJobResult('job-late', lateResult);

      expect(disposition).toBe('dropped');
      expect(mockResponseSender.sendResponse).not.toHaveBeenCalled();
      expect(mockGatewayClient.confirmDelivery).not.toHaveBeenCalled();
      expect(mockCoordinator.clearSyntheticTimeout).not.toHaveBeenCalled();
    });

    it('still confirms + clears when the follow-up send throws (finalize is unconditional)', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(recoveryCtx);
      mockPersonalityService.loadPersonality.mockResolvedValue({
        id: 'p-lila',
        name: 'lila',
        slug: 'lila',
        displayName: 'Lila',
      });
      mockClient.channels.fetch.mockResolvedValue({
        id: 'channel-late',
        isTextBased: () => true,
        isThread: () => false,
        type: 0,
      });
      mockResponseSender.sendResponse.mockRejectedValue(new Error('rate limited'));

      const disposition = await messageHandler.handleJobResult('job-late', lateResult);

      expect(disposition).toBe('delivered');
      // Send threw, but finalize() runs anyway: confirmDelivery is an idempotent
      // status flip with no retry consumer, and the marker must not linger.
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledWith('job-late');
      expect(mockCoordinator.clearSyntheticTimeout).toHaveBeenCalledWith('job-late');
      // Send failure on an already-successful late result is always-pageable —
      // the ORIGINAL error crosses the reporter seam so its stack can be hashed.
      expect(mockReportDeliveryFailure).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'rate limited' }),
        expect.objectContaining({ requestId: 'req-late' }),
        'lila'
      );
    });

    it('recovers once, then drops a duplicate result (marker cleared after first)', async () => {
      // First call sees the marker; the recovery path clears it, so the second
      // call sees null and falls through to the normal unknown-job drop.
      mockCoordinator.getSyntheticTimeout
        .mockResolvedValueOnce(recoveryCtx)
        .mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue({
        id: 'p-lila',
        name: 'lila',
        slug: 'lila',
        displayName: 'Lila',
      });
      mockClient.channels.fetch.mockResolvedValue({
        id: 'channel-late',
        isTextBased: () => true,
        isThread: () => false,
        type: 0,
      });
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m1'] });

      const first = await messageHandler.handleJobResult('job-late', lateResult);
      const second = await messageHandler.handleJobResult('job-late', lateResult);

      expect(first).toBe('delivered');
      expect(second).toBe('dropped');
      // Delivered exactly once; the duplicate produced no second follow-up.
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.confirmDelivery).toHaveBeenCalledTimes(1);
      expect(mockCoordinator.clearSyntheticTimeout).toHaveBeenCalledTimes(1);
    });

    it('reports the quota-fallback rescue when a late success result carries one', async () => {
      mockCoordinator.getSyntheticTimeout.mockResolvedValue(recoveryCtx);
      mockPersonalityService.loadPersonality.mockResolvedValue({
        id: 'p-lila',
        name: 'lila',
        slug: 'lila',
        displayName: 'Lila',
      });
      mockClient.channels.fetch.mockResolvedValue({
        id: 'channel-late',
        isTextBased: () => true,
        isThread: () => false,
        type: 0,
      });
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m1'] });
      const lateResultWithRescue = {
        ...lateResult,
        metadata: {
          ...lateResult.metadata,
          quotaFallback: {
            fromModel: 'delisted/model',
            toModel: 'admin/default',
            category: 'model_not_found',
            mode: 'reactive',
          },
        },
      } as LLMGenerationResult;

      const disposition = await messageHandler.handleJobResult('job-late', lateResultWithRescue);

      expect(disposition).toBe('delivered');
      // The mocked reportQuotaFallbackRescue delegates to reportJobError with
      // the whole result — asserting this crosses the mocked seam rather than
      // only checking the delivery succeeded. `name` is required on
      // LoadedPersonality, so the recovered personality always supplies one.
      expect(mockReportJobError).toHaveBeenCalledWith(lateResultWithRescue, 'lila');
    });
  });

  describe('handleJobResult - Async Job Completion (single-personality path)', () => {
    it('should handle job result without metadata', async () => {
      const jobId = 'job-456';
      const result = {
        requestId: 'req-456',
        success: true,
        content: 'Response without metadata',
      };

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'Bot' },
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockSlotDelivery.deliverSuccess.mockResolvedValue({ chunkMessageIds: ['msg-1'] });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // Should hand off the bare result (no metadata) to slotDelivery
      expect(mockSlotDelivery.deliverSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Response without metadata',
        }),
        expect.any(Object)
      );
    });

    it('should handle errors gracefully without throwing', async () => {
      const jobId = 'job-789';
      const result = {
        requestId: 'req-789',
        success: true,
        content: 'Content',
      };

      const mockMessage = {
        id: 'msg-error',
        reply: vi.fn().mockResolvedValue({ id: 'error-reply-123' }),
      } as unknown as Message;

      const mockPersonality = { id: 'p-1', name: 'Bot' };

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      // Simulate the inner SlotDeliveryService throwing during persistence.
      mockSlotDelivery.deliverSuccess.mockRejectedValue(new Error('Database error'));

      // Should NOT throw - handle error gracefully. `handleJobResult` now
      // reports a disposition instead of returning void, so "did not throw"
      // is expressed as the delivered verdict: the deliverError fallback
      // below still puts a message in front of the user, which is exactly
      // what must NOT be recorded as a drop.
      await expect(messageHandler.handleJobResult(jobId, result)).resolves.toBe('delivered');

      // Should still complete the job
      expect(mockJobTracker.completeJob).toHaveBeenCalledWith(jobId);

      // Should fall through to deliverError so the user sees a fallback
      // error message instead of silence.
      expect(mockSlotDelivery.deliverError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ success: true, content: 'Content' }),
        expect.objectContaining({
          personality: mockPersonality,
          channel: mockContext.channel,
        })
      );
    });

    it('should handle chunked messages correctly', async () => {
      const jobId = 'job-chunked';
      const result = {
        requestId: 'req-chunked',
        success: true,
        content: 'Very long response that will be chunked across multiple Discord messages',
      };

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'Bot' },
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockSlotDelivery.deliverSuccess.mockResolvedValue({
        chunkMessageIds: ['chunk-1', 'chunk-2', 'chunk-3'],
      });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // Chunking is internal to SlotDeliveryService (covered by its own
      // tests). At this layer we only need to confirm the long content
      // was handed off cleanly.
      expect(mockSlotDelivery.deliverSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Very long response that will be chunked across multiple Discord messages',
        }),
        expect.any(Object)
      );
    });

    it('should strip error spoiler from content when saving failed job to history', async () => {
      const jobId = 'job-failed';
      const result = {
        requestId: 'req-failed',
        success: false,
        error: 'API rate limit exceeded',
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-123',
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'ErrorBot' },
        personaId: 'persona-err',
        userMessageContent: 'Trigger error',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // Should hand the failed result to deliverError. The error-content
      // formatting (and stripErrorSpoiler before persistence) is internal
      // to SlotDeliveryService — covered by SlotDeliveryService.test.ts.
      expect(mockSlotDelivery.deliverError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ success: false, error: 'API rate limit exceeded' }),
        expect.objectContaining({ message: mockMessage })
      );
    });

    it('reports a delivery failure on a SUCCESSFUL result via reportError (pageable system error)', async () => {
      const jobId = 'job-delivery-fail';
      const result = {
        requestId: 'req-delivery-fail',
        success: true,
        content: 'a perfectly good response',
      } as unknown as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: { reply: vi.fn() } as unknown as Message,
        personality: { id: 'p-1', name: 'GoodBot' },
        personaId: 'persona-ok',
        userMessageContent: 'hi',
        userMessageTime: new Date(),
      });
      mockSlotDelivery.deliverSuccess.mockRejectedValueOnce(new TypeError('discord send failed'));

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      expect(mockReportDeliveryFailure).toHaveBeenCalledWith(
        expect.any(TypeError),
        expect.objectContaining({ requestId: 'req-delivery-fail' }),
        'GoodBot'
      );
      // The user-facing error fallback still runs after the report.
      expect(mockSlotDelivery.deliverError).toHaveBeenCalled();
    });

    it('forwards the deny-listed rate_limit category to reportJobError — the skip decision lives in ErrorChannelReporter', async () => {
      const jobId = 'job-failed-skip';
      const result = {
        requestId: 'req-failed-skip',
        success: false,
        error: 'API rate limit exceeded',
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-124',
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'ErrorBot' },
        personaId: 'persona-err',
        userMessageContent: 'Trigger error',
        userMessageTime: new Date(),
      });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'ErrorBot');
    });

    it('forwards a non-deny-listed category (server_error) to reportJobError', async () => {
      const jobId = 'job-failed-report';
      const result = {
        requestId: 'req-failed-report',
        success: false,
        error: 'upstream 500',
        errorInfo: {
          category: 'server_error' as const,
          referenceId: 'ref-125',
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'ErrorBot' },
        personaId: 'persona-err',
        userMessageContent: 'Trigger error',
        userMessageTime: new Date(),
      });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'ErrorBot');
    });

    it('reports a successful quota-fallback rescue carrying a non-deny-listed category (model_not_found)', async () => {
      // A turn rescued by the tier-aware quota fallback still arrives
      // success: true — a delisted-model persona must not self-heal
      // silently. Suppression of routine categories is reportJobError's
      // own deny-list behavior (tested in ErrorChannelReporter.test.ts);
      // this seam test only pins that the category crosses the mock.
      const jobId = 'job-success-rescue-report';
      const result = {
        requestId: 'req-success-rescue-report',
        success: true,
        content: 'Rescued response',
        metadata: {
          quotaFallback: {
            fromModel: 'delisted/model',
            toModel: 'admin/default',
            category: 'model_not_found' as const,
            mode: 'reactive' as const,
          },
        },
      } as unknown as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'RescueBot' },
        personaId: 'persona-rescue',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      });
      mockSlotDelivery.deliverSuccess.mockResolvedValue({ chunkMessageIds: ['msg-rescue'] });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'RescueBot');
    });

    it('forwards a deny-listed quota-fallback category (rate_limit) on the success path', async () => {
      const jobId = 'job-success-rescue-skip';
      const result = {
        requestId: 'req-success-rescue-skip',
        success: true,
        content: 'Rescued response',
        metadata: {
          quotaFallback: {
            fromModel: 'busy/model',
            toModel: 'admin/default',
            category: 'rate_limit' as const,
            mode: 'reactive' as const,
          },
        },
      } as unknown as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'RescueBot' },
        personaId: 'persona-rescue',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      });
      mockSlotDelivery.deliverSuccess.mockResolvedValue({ chunkMessageIds: ['msg-rescue'] });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'RescueBot');
    });

    it('does not call reportJobError on an ordinary success with no quotaFallback metadata', async () => {
      const jobId = 'job-success-no-rescue';
      const result = {
        requestId: 'req-success-no-rescue',
        success: true,
        content: 'Ordinary response',
      } as unknown as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue({
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'Bot' },
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      });
      mockSlotDelivery.deliverSuccess.mockResolvedValue({ chunkMessageIds: ['msg-1'] });

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).not.toHaveBeenCalled();
    });

    it('should include metadata in error responses for explicit failures', async () => {
      const jobId = 'job-meta-error';
      const result = {
        requestId: 'req-meta-error',
        success: false,
        error: 'API quota exceeded',
        errorInfo: {
          category: 'quota_exceeded' as const,
          referenceId: 'ref-quota-123',
        },
        metadata: {
          modelUsed: 'anthropic/claude-3-5-sonnet',
          isGuestMode: true,
          freshModeEnabled: false,
          incognitoModeActive: true,
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'MetaBot' },
        personaId: 'persona-meta',
        userMessageContent: 'Trigger quota error',
        userMessageTime: new Date(),
        isAutoResponse: false,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // Metadata flows through the result to deliverError (which then
      // forwards relevant fields to sendResponse internally — covered by
      // SlotDeliveryService.test.ts).
      expect(mockSlotDelivery.deliverError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            modelUsed: 'anthropic/claude-3-5-sonnet',
            isGuestMode: true,
            freshModeEnabled: false,
            incognitoModeActive: true,
          }),
        }),
        expect.objectContaining({ isAutoResponse: false })
      );
    });

    it('should handle error response when result.metadata is undefined', async () => {
      const jobId = 'job-no-meta';
      const result = {
        requestId: 'req-no-meta',
        success: false,
        error: 'Network timeout',
        errorInfo: {
          category: 'network_error' as const,
          referenceId: 'ref-net-123',
        },
        // Note: metadata is completely missing
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'NoMetaBot' },
        personaId: 'persona-nometa',
        userMessageContent: 'Trigger network error',
        userMessageTime: new Date(),
        isAutoResponse: true,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // No metadata on the result → deliverError still called cleanly
      // with the failed result + the slot context (which retains
      // isAutoResponse from the job context).
      expect(mockSlotDelivery.deliverError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ success: false }),
        expect.objectContaining({ isAutoResponse: true })
      );
    });

    it('should include metadata in error response for invalid content', async () => {
      const jobId = 'job-invalid-meta';
      const result = {
        requestId: 'req-invalid-meta',
        success: true,
        content: '', // Empty content triggers error path
        metadata: {
          modelUsed: 'openai/gpt-4o',
          isGuestMode: false,
          freshModeEnabled: true,
        },
      };

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'InvalidMetaBot' },
        personaId: 'persona-invmeta',
        userMessageContent: 'Trigger invalid content',
        userMessageTime: new Date(),
        isAutoResponse: false,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // An undeliverable "success" is a bug, not an expected outcome — it must
      // reach the error channel like the success:false branch does. No
      // errorInfo exists on this shape, so the category resolves to 'unknown'
      // inside reportJobError itself — this seam only pins that the result
      // and personality name cross the mock.
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'InvalidMetaBot');

      // Empty content → routes to deliverError; metadata still flows through
      // the result so the error response can render footer fields.
      expect(mockSlotDelivery.deliverError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            modelUsed: 'openai/gpt-4o',
            isGuestMode: false,
            freshModeEnabled: true,
          }),
        }),
        expect.any(Object)
      );
    });

    it('should handle error response with missing referenceId gracefully', async () => {
      const jobId = 'job-no-ref';
      const result = {
        requestId: 'req-no-ref',
        success: false,
        error: 'Provider error without reference',
        errorInfo: {
          category: 'provider_error' as const,
          // referenceId is intentionally undefined
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'NoRefBot' },
        personaId: 'persona-noref',
        userMessageContent: 'Trigger error without ref',
        userMessageTime: new Date(),
        isAutoResponse: false,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // Should call deliverError with an error-content string that
      // doesn't render "undefined" or reference-footer when referenceId
      // is missing. (Detailed buildErrorContent shape is unit-tested
      // separately; we just verify nothing weird leaks here.)
      const errorContent = mockSlotDelivery.deliverError.mock.calls[0][0] as string;
      expect(errorContent).not.toContain('undefined');
      expect(errorContent).not.toContain('reference:');
    });

    it('should strip error spoiler when saving invalid content error to history', async () => {
      const jobId = 'job-invalid';
      const result = {
        requestId: 'req-invalid',
        success: true,
        content: '', // Empty content triggers error path
      };

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'InvalidBot' },
        personaId: 'persona-inv',
        userMessageContent: 'Some message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);

      const disposition = await messageHandler.handleJobResult(jobId, result);

      expect(disposition).toBe('delivered');
      // Empty content routes to deliverError. The "strip error spoiler
      // before persistence" detail is internal to SlotDeliveryService
      // and covered there directly.
      expect(mockSlotDelivery.deliverError).toHaveBeenCalledOnce();
    });
  });

  describe('handleJobResult - Slash dispatch', () => {
    function createSlashContext(overrides: Record<string, unknown> = {}) {
      return {
        kind: 'slash' as const,
        channel: { id: 'channel-slash', send: vi.fn().mockResolvedValue({ id: 'fb-1' }) } as any,
        guildId: 'guild-slash',
        clientId: 'bot-slash',
        userMessageTime: new Date('2026-05-08T10:00:00Z'),
        personality: { id: 'pers-slash', name: 'SlashBot' } as any,
        personaId: 'persona-slash',
        characterSlug: 'slash-char',
        isWeighInMode: false,
        userId: 'user-slash',
        ...overrides,
      };
    }

    it('routes successful slash result to DiscordResponseSender with full metadata', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1', 'm-2'] });

      const result = {
        requestId: 'req-slash',
        success: true,
        content: 'Slash response',
        metadata: {
          modelUsed: 'anthropic/claude',
          providerUsed: 'openrouter',
          isGuestMode: false,
          ttsAudioKey: 'tts-key-1',
          ttsAudioContentType: 'audio/ogg',
          thinkingContent: 'reasoning...',
        },
      } as unknown as LLMGenerationResult;

      const disposition = await messageHandler.handleJobResult('job-slash-1', result);

      expect(disposition).toBe('delivered');
      // Slash branch dispatches with channel/guildId/clientId from context
      // (no `message` field — that's the parity-gain compared to the old polling sender).
      // recipientUserId must be explicit on this path — SlashJobContext has no
      // Message anchor so there's no message.author.id to fall back on at
      // delivery time when gating bot-owner-only signals (ttsNotices).
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Slash response',
          channel: ctx.channel,
          guildId: 'guild-slash',
          clientId: 'bot-slash',
          recipientUserId: 'user-slash',
          modelUsed: 'anthropic/claude',
          ttsAudioKey: 'tts-key-1',
        })
      );
    });

    it('forwards ttsNotices on the slash success path so bot-owner notices reach delivery', async () => {
      // ttsNotices from the job result must reach sendResponse on the slash
      // path. SlashJobContext carries userId explicitly (no Message anchor
      // to read author.id from) so the response sender can gate bot-owner-
      // only signals by recipient.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      const result = {
        requestId: 'req-slash-notices',
        success: true,
        content: 'Hello with notices',
        metadata: {
          ttsNotices: [
            'Voice reference for "slash-char" is 45.0s, exceeding limit. Mistral was skipped.',
          ],
        },
      } as unknown as LLMGenerationResult;

      const disposition = await messageHandler.handleJobResult('job-slash-notices', result);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: 'user-slash',
          ttsNotices: result.metadata!.ttsNotices,
        })
      );
    });

    it('forwards the reasoning trace across the persistence seam on the slash path', async () => {
      // Rule 7: persistence is mocked here, so a dropped or misspelled field
      // name would cross this seam invisibly and every other test would pass.
      // The webhook path's equivalent is pinned in SlotDeliveryService.test.ts.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      const disposition = await messageHandler.handleJobResult('job-slash-trace', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
        metadata: { thinkingContent: 'SLASH-PATH-TRACE-SENTINEL' },
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockPersistence.saveAssistantMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingContent: 'SLASH-PATH-TRACE-SENTINEL' })
      );
    });

    it('persists assistant message via saveAssistantMessageFromFields (no Message anchor)', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      const disposition = await messageHandler.handleJobResult('job-slash-2', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockPersistence.saveAssistantMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-slash',
          guildId: 'guild-slash',
          personaId: 'persona-slash',
          chunkMessageIds: ['m-1'],
          content: 'Hi',
          userMessageTime: ctx.userMessageTime,
        })
      );
      // Message-flavored persistence stays untouched on slash path.
      expect(mockPersistence.saveAssistantMessage).not.toHaveBeenCalled();
    });

    it('persists assistant response in weigh-in mode (history-only; memory stays gated in ai-worker)', async () => {
      // Weigh-in/chime-in responses ARE persisted to conversation history so they
      // survive past the live-fetch window and stay in cross-turn continuity.
      // Long-term memory creation is gated separately on isWeighIn in the
      // ai-worker, so persisting here does not violate incognito semantics.
      const ctx = createSlashContext({ isWeighInMode: true });
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      const disposition = await messageHandler.handleJobResult('job-weighin', {
        requestId: 'req-slash',
        success: true,
        content: 'Weighing in',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockPersistence.saveAssistantMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Weighing in', chunkMessageIds: ['m-1'] })
      );
    });

    it('a persist failure after a delivered send does not post an error message', async () => {
      // Same posture as SlotDeliveryService.persistDeliveredTurn: the reply is
      // already on Discord, so a persist failure surviving the retry must not
      // fall into the outer catch and send a SECOND message on top of it.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });
      mockPersistence.saveAssistantMessageFromFields.mockRejectedValueOnce(
        new Error('gateway down after retries')
      );

      const disposition = await messageHandler.handleJobResult('job-slash-persist-fail', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
    });

    it('updates diagnostic response IDs with the slash requestId', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1', 'm-2'] });

      const disposition = await messageHandler.handleJobResult('job-diag', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      // Wait a tick for the fire-and-forget update
      await new Promise(resolve => setImmediate(resolve));

      expect(mockGatewayClient.updateDiagnosticResponseIds).toHaveBeenCalledWith('req-slash', [
        'm-1',
        'm-2',
      ]);
    });

    it('routes explicit failure (success: false) through error path', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-1'] });

      const disposition = await messageHandler.handleJobResult('job-fail', {
        requestId: 'req-slash',
        success: false,
        error: 'rate limited',
        errorInfo: { category: 'rate_limit', referenceId: 'ref-1' },
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      // sendResponse called with error content (not 'Hi')
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: ctx.channel,
          guildId: 'guild-slash',
        })
      );
      const sentContent = mockResponseSender.sendResponse.mock.calls[0][0].content;
      expect(typeof sentContent).toBe('string');
      expect(sentContent.length).toBeGreaterThan(0);
    });

    it('forwards the deny-listed rate_limit category to reportJobError from the slash path — skip decision downstream', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-2'] });

      const result = {
        requestId: 'req-slash-skip',
        success: false,
        error: 'rate limited',
        errorInfo: { category: 'rate_limit', referenceId: 'ref-2' },
      } as unknown as LLMGenerationResult;
      const disposition = await messageHandler.handleJobResult('job-fail-skip', result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'SlashBot');
    });

    it('forwards a non-deny-listed category to reportJobError from the slash path', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-3'] });

      const result = {
        requestId: 'req-slash-report',
        success: false,
        error: 'model not found',
        errorInfo: { category: 'model_not_found', referenceId: 'ref-3' },
      } as unknown as LLMGenerationResult;
      const disposition = await messageHandler.handleJobResult('job-fail-report', result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'SlashBot');
    });

    it('reports a successful quota-fallback rescue on the slash path (model_not_found)', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-rescue'] });

      const result = {
        requestId: 'req-slash-rescue-report',
        success: true,
        content: 'Rescued slash response',
        metadata: {
          quotaFallback: {
            fromModel: 'delisted/model',
            toModel: 'admin/default',
            category: 'model_not_found',
            mode: 'reactive',
          },
        },
      } as unknown as LLMGenerationResult;
      const disposition = await messageHandler.handleJobResult('job-slash-rescue-report', result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'SlashBot');
    });

    it('does not call reportJobError on an ordinary slash success with no quotaFallback metadata', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-ordinary'] });

      const disposition = await messageHandler.handleJobResult('job-slash-no-rescue', {
        requestId: 'req-slash-no-rescue',
        success: true,
        content: 'Ordinary slash response',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).not.toHaveBeenCalled();
    });

    it('reports an empty-content "success" from the slash path — undeliverable success is a bug', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-4'] });

      const result = {
        requestId: 'req-empty-slash',
        success: true,
        content: '',
      } as unknown as LLMGenerationResult;
      const disposition = await messageHandler.handleJobResult('job-empty-slash', result);

      expect(disposition).toBe('delivered');
      expect(mockReportJobError).toHaveBeenCalledWith(result, 'SlashBot');
    });

    it('falls back to channel.send when responseSender throws on the error path', async () => {
      const channelSend = vi.fn().mockResolvedValue({ id: 'fb-1' });
      const ctx = createSlashContext({
        channel: { id: 'channel-slash', send: channelSend } as any,
      });
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockRejectedValueOnce(new Error('webhook down'));

      const disposition = await messageHandler.handleJobResult('job-fb', {
        requestId: 'req-slash',
        success: false,
        error: 'something',
        errorInfo: { category: 'unknown_error' },
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(channelSend).toHaveBeenCalled();
    });

    it('completes the JobTracker entry on slash result delivery', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      const disposition = await messageHandler.handleJobResult('job-complete', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockJobTracker.completeJob).toHaveBeenCalledWith('job-complete');
    });

    it('routes truthy-but-empty content (success=true, content="") through the error path', async () => {
      // Distinct from `success: false` — an ai-worker can mark the job
      // successful while returning empty content (model produced nothing
      // visible). The slash branch must still send an error to the user
      // rather than silently dispatching an empty webhook message.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-empty-1'] });

      const disposition = await messageHandler.handleJobResult('job-empty', {
        requestId: 'req-slash',
        success: true,
        content: '',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      // sendResponse called with a non-empty error message (not the empty content).
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      const sentContent = mockResponseSender.sendResponse.mock.calls[0][0].content;
      expect(typeof sentContent).toBe('string');
      expect(sentContent.length).toBeGreaterThan(0);
    });

    it('a persist failure after a delivered ERROR send does not post a second error message', async () => {
      // Symmetric with the success-path isolation: the error content is
      // already delivered via sendResponse, so a persist failure must not
      // fall into the outer catch and channel.send a SECOND error message.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-1'] });
      mockPersistence.saveAssistantMessageFromFields.mockRejectedValueOnce(
        new Error('gateway down after retries')
      );

      const disposition = await messageHandler.handleJobResult('job-slash-err-persist', {
        requestId: 'req-slash',
        success: false,
        error: 'model exploded',
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      expect(ctx.channel.send).not.toHaveBeenCalled();
    });

    it('routes null content (success=true, content=null) through the error path', async () => {
      // sendSlashErrorResponse still persists even on the error path, so we can't use
      // saveAssistantMessageFromFields as a proxy for "took the error path" here.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-null-1'] });

      const disposition = await messageHandler.handleJobResult('job-null', {
        requestId: 'req-slash',
        success: true,
        content: null,
      } as unknown as LLMGenerationResult);

      expect(disposition).toBe('delivered');
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      const sentContent = mockResponseSender.sendResponse.mock.calls[0][0].content;
      expect(typeof sentContent).toBe('string');
      expect(sentContent.length).toBeGreaterThan(0);
    });
  });
});
