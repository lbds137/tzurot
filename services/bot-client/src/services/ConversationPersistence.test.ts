/**
 * ConversationPersistence Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationPersistence } from './ConversationPersistence.js';
import type { LoadedPersonality, ReferencedMessage } from '@tzurot/common-types';
import { MessageRole } from '@tzurot/common-types';
import type { Message } from 'discord.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');

  // Define mock class inside the factory
  class MockConversationHistoryService {
    addMessage = vi.fn().mockResolvedValue(undefined);
    updateLastUserMessage = vi.fn().mockResolvedValue(undefined);
  }

  return {
    ...actual,
    ConversationHistoryService: MockConversationHistoryService,
  };
});

vi.mock('../utils/attachmentPlaceholders.js', () => ({
  generateAttachmentPlaceholders: vi.fn(attachments => {
    return `\n\n[Placeholder: ${attachments.length} attachment(s)]`;
  }),
}));

vi.mock('../utils/forwardedMessageUtils.js', () => ({
  isForwardedMessage: vi.fn(() => false),
}));

// Default mock returns no embeds. Tests that need forwarded embed behavior
// override with mockResolvedValueOnce().
vi.mock('../utils/MessageContentBuilder.js', () => ({
  buildMessageContent: vi.fn().mockResolvedValue({
    content: '',
    attachments: [],
    hasVoiceMessage: false,
    embedsXml: undefined,
  }),
}));

vi.mock('../utils/contextWritePath.js', () => ({
  dualWritePersistAssistantMessage: vi.fn().mockResolvedValue(undefined),
  persistAssistantMessageViaGateway: vi.fn().mockResolvedValue(undefined),
  dualWritePersistUserMessage: vi.fn().mockResolvedValue(undefined),
  persistUserMessageViaGateway: vi.fn().mockResolvedValue(undefined),
  getContextMode: vi.fn(() => 'legacy'),
}));

import {
  dualWritePersistAssistantMessage,
  persistAssistantMessageViaGateway,
  dualWritePersistUserMessage,
  persistUserMessageViaGateway,
  getContextMode,
} from '../utils/contextWritePath.js';

describe('ConversationPersistence', () => {
  let persistence: ConversationPersistence;
  let mockConversationHistory: {
    addMessage: ReturnType<typeof vi.fn>;
    updateLastUserMessage: ReturnType<typeof vi.fn>;
  };
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();

    // Constructor expects PrismaClient but we've mocked ConversationHistoryService
    persistence = new ConversationPersistence({} as any);
    mockConversationHistory = (
      persistence as unknown as { conversationHistory: typeof mockConversationHistory }
    ).conversationHistory;

    mockPersonality = {
      id: 'personality-123',
      name: 'TestBot',
      displayName: 'Test Bot',
      systemPrompt: 'You are a test bot',
      llmConfig: {
        model: 'test-model',
        provider: 'openrouter',
        temperature: 0.7,
        maxTokens: 1000,
      },
    } as unknown as LoadedPersonality;
  });

  describe('saveUserMessage', () => {
    it('should save user message with text content only', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Hello bot!',
      });

      // New storage format: options object
      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.User,
        content: 'Hello bot!',
        guildId: 'guild-123',
        discordMessageId: 'discord-msg-123',
        messageMetadata: undefined, // no references
        timestamp: expect.any(Date),
      });
    });

    it('should pass Discord message createdAt as the row timestamp', async () => {
      // Regression test: without this, the user row's createdAt defaulted to
      // `new Date()` (DB insert time), while the corresponding assistant row
      // used `userMessageTime + 1ms` (Discord post + 1ms). That made the
      // assistant's createdAt *earlier* than the user's, reversing every
      // turn-pair in cross-channel-context output.
      const discordPostTime = new Date('2026-05-16T15:42:10.000Z');
      const mockMessage = createMockMessage({
        id: 'discord-msg-timestamp',
        channelId: 'channel-timestamp',
        guildId: 'guild-timestamp',
      });
      // Set createdAt after construction — createMockMessage's options object
      // is typed `MockInput<Message> = Record<string, any>`, but TS catches the
      // mismatch against Discord's Message type when `createdAt` is declared in
      // the overrides literal. Direct assignment avoids that.
      Object.assign(mockMessage as unknown as { createdAt: Date }, {
        createdAt: discordPostTime,
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-timestamp',
        messageContent: 'Hi',
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: discordPostTime })
      );
    });

    it('should use default content when message content is empty', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: null,
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: '',
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.User,
        content: '[no text content]',
        guildId: null,
        discordMessageId: 'discord-msg-123',
        messageMetadata: undefined,
        timestamp: expect.any(Date),
      });
    });

    it('should include attachment placeholders', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const attachments = [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }];

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Check this image',
        attachments,
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.User,
        content: 'Check this image\n\n[Placeholder: 1 attachment(s)]',
        guildId: 'guild-123',
        discordMessageId: 'discord-msg-123',
        messageMetadata: undefined, // no references
        timestamp: expect.any(Date),
      });
    });

    it('should store references in messageMetadata, not content', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'ref-msg-1',
          discordUserId: 'user-456',
          authorUsername: 'otheruser',
          authorDisplayName: 'Other User',
          content: 'Referenced message',
          embeds: '',
          timestamp: '2025-01-01T10:00:00Z',
          locationContext: 'Test Guild > #general',
        },
      ];

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Replying to [Reference 1]',
        referencedMessages,
      });

      // Content should NOT contain references - they go in messageMetadata
      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.User,
        content: 'Replying to [Reference 1]', // Just the text, no reference content
        guildId: 'guild-123',
        discordMessageId: 'discord-msg-123',
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'ref-msg-1',
              authorUsername: 'otheruser',
              authorDisplayName: 'Other User',
              content: 'Referenced message',
              embeds: undefined,
              timestamp: '2025-01-01T10:00:00Z',
              locationContext: 'Test Guild > #general',
              attachments: undefined,
              isForwarded: undefined,
            },
          ],
        },
        timestamp: expect.any(Date),
      });
    });

    it('should persist isForwarded in messageMetadata for forwarded messages', async () => {
      const { isForwardedMessage } = await import('../utils/forwardedMessageUtils.js');
      vi.mocked(isForwardedMessage).mockReturnValueOnce(true);

      const mockMessage = createMockMessage({
        id: 'discord-msg-fwd',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Forwarded content',
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.User,
        content: 'Forwarded content',
        guildId: 'guild-123',
        discordMessageId: 'discord-msg-fwd',
        messageMetadata: { isForwarded: true },
        timestamp: expect.any(Date),
      });
    });

    it('should persist embedsXml in messageMetadata for forwarded messages with embeds', async () => {
      const { isForwardedMessage } = await import('../utils/forwardedMessageUtils.js');
      vi.mocked(isForwardedMessage).mockReturnValueOnce(true);

      const { buildMessageContent } = await import('../utils/MessageContentBuilder.js');
      vi.mocked(buildMessageContent).mockResolvedValueOnce({
        content: '',
        attachments: [],
        hasVoiceMessage: false,
        isForwarded: true,
        embedsXml: ['<embed title="Link Preview">Some content</embed>'],
      });

      const mockMessage = createMockMessage({
        id: 'discord-msg-fwd-embeds',
        channelId: 'channel-123',
        guildId: 'guild-123',
        embeds: [{ data: { title: 'Link Preview' } }],
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Forwarded with embeds',
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageMetadata: {
            isForwarded: true,
            embedsXml: ['<embed title="Link Preview">Some content</embed>'],
          },
        })
      );
    });

    it('should persist embedsXml for non-forwarded messages with embeds (link previews)', async () => {
      // Regression: a regular link-embed message (not forwarded) must persist
      // its embed XML so the history doesn't render blank once the message ages
      // out of the Discord API fetch window. isForwardedMessage stays false here.
      const { buildMessageContent } = await import('../utils/MessageContentBuilder.js');
      vi.mocked(buildMessageContent).mockResolvedValueOnce({
        content: '',
        attachments: [],
        hasVoiceMessage: false,
        isForwarded: false,
        embedsXml: ['<embed title="Link Preview">Some content</embed>'],
      });

      const mockMessage = createMockMessage({
        id: 'discord-msg-link-embed',
        channelId: 'channel-123',
        guildId: 'guild-123',
        embeds: [{ data: { title: 'Link Preview' } }],
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Check out this link',
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageMetadata: { embedsXml: ['<embed title="Link Preview">Some content</embed>'] },
        })
      );
    });

    it('should not call buildMessageContent for messages without embeds', async () => {
      const { buildMessageContent } = await import('../utils/MessageContentBuilder.js');
      vi.mocked(buildMessageContent).mockClear();

      const mockMessage = createMockMessage({
        id: 'discord-msg-normal',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Normal message',
      });

      expect(buildMessageContent).not.toHaveBeenCalled();
    });

    it('should store both attachments in content and references in metadata', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const attachments = [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }];

      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'ref-msg-1',
          discordUserId: 'user-456',
          authorUsername: 'otheruser',
          authorDisplayName: 'Other User',
          content: 'Referenced message',
          embeds: '',
          timestamp: '2025-01-01T10:00:00Z',
          locationContext: 'Test Guild > #general',
        },
      ];

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Image with reference',
        attachments,
        referencedMessages,
      });

      // Attachments go in content (as placeholders), references go in metadata
      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.User,
        content: 'Image with reference\n\n[Placeholder: 1 attachment(s)]', // Attachments in content
        guildId: 'guild-123',
        discordMessageId: 'discord-msg-123',
        messageMetadata: {
          referencedMessages: expect.any(Array), // References in metadata
        },
        timestamp: expect.any(Date),
      });
    });
  });

  describe('saveUserMessage context-mode routing', () => {
    it('legacy mode: fires the dual-write mirror with the SAME timestamp the local write used', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Hello bot!',
      });

      expect(dualWritePersistUserMessage).toHaveBeenCalledTimes(1);
      const mirrorParams = vi.mocked(dualWritePersistUserMessage).mock.calls[0][0];
      const localCall = mockConversationHistory.addMessage.mock.calls[0][0];
      // The deterministic row id derives from this timestamp — both paths
      // must share one resolved value or dual-write produces false divergence.
      expect(mirrorParams.messageTime).toBe(localCall.timestamp);
      expect(persistUserMessageViaGateway).not.toHaveBeenCalled();
    });

    it('service mode: the gateway write is authoritative and the local write is skipped', async () => {
      vi.mocked(getContextMode).mockReturnValueOnce('service');
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Hello bot!',
      });

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          guildId: 'guild-123',
          personalityId: 'personality-123',
          personaId: 'persona-uuid-123',
          content: 'Hello bot!',
          discordMessageId: 'discord-msg-123',
          messageTime: expect.any(Date),
        })
      );
      expect(mockConversationHistory.addMessage).not.toHaveBeenCalled();
      expect(dualWritePersistUserMessage).not.toHaveBeenCalled();
    });

    it('service mode: gateway write failures propagate to the caller', async () => {
      vi.mocked(getContextMode).mockReturnValueOnce('service');
      vi.mocked(persistUserMessageViaGateway).mockRejectedValueOnce(new Error('gateway down'));
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await expect(
        persistence.saveUserMessage({
          message: mockMessage,
          personality: mockPersonality,
          personaId: 'persona-uuid-123',
          messageContent: 'Hello bot!',
        })
      ).rejects.toThrow('gateway down');
    });
  });

  describe('saveAssistantMessage', () => {
    it('should save assistant message with correct timestamp', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const userMessageTime = new Date('2025-01-01T10:00:00.000Z');
      const expectedAssistantTime = new Date('2025-01-01T10:00:00.001Z');

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'Assistant response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.Assistant,
        content: 'Assistant response',
        guildId: 'guild-123',
        discordMessageId: ['chunk-1'],
        timestamp: expectedAssistantTime,
      });
    });

    it('fires the dual-write mirror with the original userMessageTime after the local save', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });
      const userMessageTime = new Date('2025-01-01T10:00:00.000Z');

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'Assistant response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
      });

      // The helper receives userMessageTime, NOT the +1ms assistant time —
      // the gateway derives the +1ms itself.
      expect(dualWritePersistAssistantMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Assistant response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
      });
    });

    it('service mode: the gateway write is authoritative and the local write is skipped', async () => {
      vi.mocked(getContextMode).mockReturnValueOnce('service');
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });
      const userMessageTime = new Date('2025-01-01T10:00:00.000Z');

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'Assistant response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
      });

      expect(persistAssistantMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Assistant response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
      });
      expect(mockConversationHistory.addMessage).not.toHaveBeenCalled();
      expect(dualWritePersistAssistantMessage).not.toHaveBeenCalled();
    });

    it('service mode: gateway write failures propagate to the caller', async () => {
      vi.mocked(getContextMode).mockReturnValueOnce('service');
      vi.mocked(persistAssistantMessageViaGateway).mockRejectedValueOnce(new Error('gateway down'));
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await expect(
        persistence.saveAssistantMessage({
          message: mockMessage,
          personality: mockPersonality,
          personaId: 'persona-uuid-123',
          content: 'Assistant response',
          chunkMessageIds: ['chunk-1'],
          userMessageTime: new Date('2025-01-01T10:00:00.000Z'),
        })
      ).rejects.toThrow('gateway down');
    });

    it('should handle multiple chunk message IDs', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const userMessageTime = new Date('2025-01-01T10:00:00.000Z');

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'Long response that was chunked',
        chunkMessageIds: ['chunk-1', 'chunk-2', 'chunk-3'],
        userMessageTime,
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.Assistant,
        content: 'Long response that was chunked',
        guildId: 'guild-123',
        discordMessageId: ['chunk-1', 'chunk-2', 'chunk-3'],
        timestamp: expect.any(Date),
      });
    });

    it('should not save if no chunk message IDs', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const userMessageTime = new Date('2025-01-01T10:00:00.000Z');

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'Response',
        chunkMessageIds: [],
        userMessageTime,
      });

      expect(mockConversationHistory.addMessage).not.toHaveBeenCalled();
    });

    it('should handle DM channels (no guild)', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'dm-channel-123',
        guildId: null,
      });

      const userMessageTime = new Date('2025-01-01T10:00:00.000Z');

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'DM response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
      });

      expect(mockConversationHistory.addMessage).toHaveBeenCalledWith({
        channelId: 'dm-channel-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        role: MessageRole.Assistant,
        content: 'DM response',
        guildId: null,
        discordMessageId: ['chunk-1'],
        timestamp: expect.any(Date),
      });
    });
  });
});

// Helper function to create mock Discord messages
function createMockMessage(options: {
  id: string;
  channelId: string;
  guildId: string | null;
  embeds?: unknown[];
}): Message {
  return {
    id: options.id,
    channel: {
      id: options.channelId,
      isThread: () => false,
    },
    guild: options.guildId ? { id: options.guildId } : null,
    embeds: options.embeds ?? [],
  } as unknown as Message;
}
