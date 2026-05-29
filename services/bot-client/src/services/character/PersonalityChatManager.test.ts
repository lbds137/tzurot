/**
 * PersonalityChatManager Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityChatManager } from './PersonalityChatManager.js';
import type { Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';

// Mock NSFW verification — defaults to allow-through
vi.mock('../../utils/nsfwVerification.js', () => ({
  handleNsfwVerification: vi.fn().mockResolvedValue({ allowed: true, wasNewVerification: false }),
  sendVerificationConfirmation: vi.fn().mockResolvedValue(undefined),
  isNsfwChannel: vi.fn().mockReturnValue(false),
  isDMChannel: vi.fn().mockReturnValue(false),
  checkNsfwVerification: vi
    .fn()
    .mockResolvedValue({ kind: 'ok', value: { nsfwVerified: true, nsfwVerifiedAt: null } }),
}));

// Stub the resolveUserLlmConfig method on userClient; defaults to LlmConfig defaults.
const mockResolveUserLlmConfig = vi.fn().mockResolvedValue({
  ok: true,
  data: {
    config: {
      model: 'test-model',
      provider: 'openrouter',
      maxMessages: 50,
      maxAge: null,
      maxImages: 10,
    },
    source: 'personality',
  },
});

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsForUser: vi.fn(() => ({
    userClient: {
      actor: 'user-123',
      resolveUserLlmConfig: mockResolveUserLlmConfig,
    },
    ownerClient: { actor: 'mock-owner' },
  })),
}));

import * as nsfwVerification from '../../utils/nsfwVerification.js';

describe('PersonalityChatManager', () => {
  let manager: PersonalityChatManager;
  let mockGatewayClient: { generate: ReturnType<typeof vi.fn> };
  let mockContextBuilder: { buildContext: ReturnType<typeof vi.fn> };
  let mockPersistence: { saveUserMessage: ReturnType<typeof vi.fn> };
  let mockReferenceEnricher: { enrichWithPersonaNames: ReturnType<typeof vi.fn> };
  let mockDenylistCache: { isPersonalityDenied: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGatewayClient = { generate: vi.fn().mockResolvedValue({ jobId: 'job-123' }) };
    mockContextBuilder = {
      buildContext: vi.fn().mockResolvedValue({
        context: {
          attachments: [],
          referencedMessages: [],
          conversationHistory: [],
        },
        personaId: 'persona-123',
        messageContent: 'Hello AI',
        referencedMessages: [],
        conversationHistory: [],
      }),
    };
    mockPersistence = { saveUserMessage: vi.fn().mockResolvedValue(undefined) };
    mockReferenceEnricher = { enrichWithPersonaNames: vi.fn().mockResolvedValue(undefined) };
    mockDenylistCache = { isPersonalityDenied: vi.fn().mockReturnValue(false) };

    manager = new PersonalityChatManager({
      gatewayClient: mockGatewayClient as any,
      contextBuilder: mockContextBuilder as any,
      persistence: mockPersistence as any,
      referenceEnricher: mockReferenceEnricher as any,
      denylistCache: mockDenylistCache as any,
    });
  });

  describe('submitChatJob - happy path', () => {
    it('submits the job and returns a tracking context', async () => {
      const message = createMockMessage();
      const personality = createMockPersonality();

      const result = await manager.submitChatJob({
        message,
        personality,
        content: 'Hello AI',
      });

      expect(result.kind).toBe('submitted');
      if (result.kind !== 'submitted') return;

      expect(result.jobId).toBe('job-123');
      expect(result.trackingContext.kind).toBe('message');
      expect(result.trackingContext.message).toBe(message);
      expect(result.trackingContext.personality).toBe(personality);
      expect(result.trackingContext.personaId).toBe('persona-123');
      expect(result.trackingContext.userMessageContent).toBe('Hello AI');
      expect(result.trackingContext.guildId).toBe('test-guild');
      expect(result.trackingContext.clientId).toBe('bot-123');
      expect(result.trackingContext.channel).toBe(message.channel);

      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          triggerMessageId: 'message-123',
        })
      );
      expect(mockPersistence.saveUserMessage).toHaveBeenCalled();
    });

    it('propagates isAutoResponse onto the tracking context', async () => {
      const result = await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
        isAutoResponse: true,
      });

      expect(result.kind).toBe('submitted');
      if (result.kind !== 'submitted') return;
      expect(result.trackingContext.isAutoResponse).toBe(true);
    });

    it('enriches references when present', async () => {
      mockContextBuilder.buildContext.mockResolvedValueOnce({
        context: {
          attachments: [],
          referencedMessages: [{ id: 'ref-1' }],
          conversationHistory: [],
        },
        personaId: 'persona-123',
        messageContent: 'Hi',
        referencedMessages: [{ referenceNumber: 1 }],
        conversationHistory: [{ id: 'conv-1' }],
      });

      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockReferenceEnricher.enrichWithPersonaNames).toHaveBeenCalledTimes(1);
    });
  });

  describe('submitChatJob - gates', () => {
    it('returns denylisted when user+personality is denied', async () => {
      mockDenylistCache.isPersonalityDenied.mockReturnValueOnce(true);

      const result = await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(result.kind).toBe('denied');
      if (result.kind !== 'denied') return;
      expect(result.reason).toBe('denylisted');
      expect(mockGatewayClient.generate).not.toHaveBeenCalled();
    });

    it('returns nsfw-blocked when verification disallows', async () => {
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValueOnce({
        allowed: false,
        wasNewVerification: false,
      });

      const result = await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(result.kind).toBe('denied');
      if (result.kind !== 'denied') return;
      expect(result.reason).toBe('nsfw-blocked');
    });

    it('sends a confirmation when wasNewVerification is true', async () => {
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValueOnce({
        allowed: true,
        wasNewVerification: true,
      });

      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(nsfwVerification.sendVerificationConfirmation).toHaveBeenCalledTimes(1);
    });

    it('returns unsupported-channel for non-typing channels', async () => {
      const message = createMockMessage();
      // Override channel type to a non-typing channel (e.g., voice)
      (message.channel as any).type = ChannelType.GuildVoice;

      const result = await manager.submitChatJob({
        message,
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(result.kind).toBe('denied');
      if (result.kind !== 'denied') return;
      expect(result.reason).toBe('unsupported-channel');
      expect(mockGatewayClient.generate).not.toHaveBeenCalled();
    });
  });

  describe('submitChatJob - config resolve fallback', () => {
    it('falls back to personality defaults on resolve failure', async () => {
      mockResolveUserLlmConfig.mockResolvedValueOnce({
        ok: false,
        error: 'resolve unavailable',
      } as never);

      const result = await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      // Still submits — the manager degrades gracefully on a resolve failure
      // and uses personality defaults rather than aborting the request.
      expect(result.kind).toBe('submitted');
      expect(mockContextBuilder.buildContext).toHaveBeenCalled();
    });

    it('skips reference enrichment when no references present', async () => {
      // Default mock returns referencedMessages: [] — reference enricher should not fire
      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockReferenceEnricher.enrichWithPersonaNames).not.toHaveBeenCalled();
    });
  });

  describe('submitChatJob - extended context', () => {
    it('passes extended context settings from resolved config to buildContext', async () => {
      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'Hi',
        expect.objectContaining({
          extendedContext: {
            maxMessages: 50,
            maxAge: null,
            maxImages: 10,
            sources: {
              maxMessages: 'personality',
              maxAge: 'personality',
              maxImages: 'personality',
            },
          },
          botUserId: 'bot-123',
          crossChannelHistoryEnabled: false,
        })
      );
    });

    it('prefers cascade overrides over LlmConfig values', async () => {
      mockResolveUserLlmConfig.mockResolvedValueOnce({
        ok: true,
        data: {
          config: { model: 'm', maxMessages: 50, maxAge: null, maxImages: 10 },
          source: 'user-personality',
          overrides: {
            maxMessages: 200,
            maxAge: 7,
            maxImages: 5,
            crossChannelHistoryEnabled: false,
            sources: {
              maxMessages: 'user-personality',
              maxAge: 'channel',
              maxImages: 'user-default',
            },
          },
        },
      } as never);

      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          extendedContext: {
            maxMessages: 200,
            maxAge: 7,
            maxImages: 5,
            sources: {
              maxMessages: 'user-personality',
              maxAge: 'channel',
              maxImages: 'user-default',
            },
          },
        })
      );
    });

    it('threads crossChannelHistoryEnabled through from cascade override', async () => {
      mockResolveUserLlmConfig.mockResolvedValueOnce({
        ok: true,
        data: {
          config: { model: 'm', maxMessages: 50, maxAge: null, maxImages: 10 },
          source: 'user-personality',
          overrides: {
            maxMessages: 50,
            maxAge: null,
            maxImages: 10,
            crossChannelHistoryEnabled: true,
            sources: {
              maxMessages: 'user-personality',
              maxAge: 'user-personality',
              maxImages: 'user-personality',
            },
          },
        },
      } as never);

      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ crossChannelHistoryEnabled: true })
      );
    });

    it('passes channelId to the resolve-config gateway call', async () => {
      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockResolveUserLlmConfig).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'channel-123' })
      );
    });
  });

  describe('submitChatJob - persistence', () => {
    it('saves user message with attachments and references from buildContext', async () => {
      const attachments = [
        { url: 'https://x/y.png', contentType: 'image/png', name: 'y.png', size: 100 },
      ];
      const referencedMessages = [{ referenceNumber: 1, content: 'prev' }];

      mockContextBuilder.buildContext.mockResolvedValueOnce({
        context: { attachments, referencedMessages, conversationHistory: [] },
        personaId: 'persona-1',
        messageContent: 'Hi',
        referencedMessages,
        conversationHistory: [],
      });

      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(mockPersistence.saveUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ attachments, referencedMessages })
      );
    });
  });

  describe('submitChatJob - NSFW edge cases', () => {
    it('does not send confirmation when wasNewVerification is false', async () => {
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValueOnce({
        allowed: true,
        wasNewVerification: false,
      });

      await manager.submitChatJob({
        message: createMockMessage(),
        personality: createMockPersonality(),
        content: 'Hi',
      });

      expect(nsfwVerification.sendVerificationConfirmation).not.toHaveBeenCalled();
    });
  });
});

function createMockMessage(): Message {
  return {
    id: 'message-123',
    guildId: 'test-guild',
    author: {
      id: 'user-123',
      username: 'testuser',
      globalName: 'Test User',
      bot: false,
    },
    channel: {
      id: 'channel-123',
      type: ChannelType.GuildText,
    },
    client: {
      user: { id: 'bot-123' },
    },
    reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
  } as unknown as Message;
}

function createMockPersonality(): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'test-bot',
    displayName: 'Test Bot',
    slug: 'test-bot',
    systemPrompt: 'You are a test bot',
    voiceEnabled: false,
    model: 'test-model',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 1000,
  } as unknown as LoadedPersonality;
}
