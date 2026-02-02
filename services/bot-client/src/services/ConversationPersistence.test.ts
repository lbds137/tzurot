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

// Note: referenceFormatter is no longer used - references are stored in messageMetadata

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
      });
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
      });
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
      });
    });
  });

  describe('updateUserMessage', () => {
    it('should not update if no rich descriptions provided', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.updateUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Message content',
      });

      expect(mockConversationHistory.updateLastUserMessage).not.toHaveBeenCalled();
    });

    it('should upgrade with attachment descriptions only', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.updateUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Message content',
        attachmentDescriptions: 'Rich image description from AI',
      });

      expect(mockConversationHistory.updateLastUserMessage).toHaveBeenCalledWith(
        'channel-123',
        'personality-123',
        'persona-uuid-123',
        'Message content\n\nRich image description from AI'
      );
    });

    it('should not update when no attachment descriptions provided', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      // References are stored in messageMetadata during saveUserMessage,
      // so not having attachment descriptions means no update needed
      await persistence.updateUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Message content',
        // no attachment descriptions
      });

      // Should NOT call update since there's no attachment description
      expect(mockConversationHistory.updateLastUserMessage).not.toHaveBeenCalled();
    });

    it('should handle empty message content with descriptions', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.updateUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: '',
        attachmentDescriptions: 'Voice transcription',
      });

      expect(mockConversationHistory.updateLastUserMessage).toHaveBeenCalledWith(
        'channel-123',
        'personality-123',
        'persona-uuid-123',
        'Voice transcription'
      );
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
}): Message {
  return {
    id: options.id,
    channel: {
      id: options.channelId,
      isThread: () => false,
    },
    guild: options.guildId ? { id: options.guildId } : null,
  } as unknown as Message;
}
