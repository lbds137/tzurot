/**
 * ConversationPersistence Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationPersistence } from './ConversationPersistence.js';
import type { ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { Message } from 'discord.js';

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

// The conversation write IS the gateway endpoint — bot-client performs no
// local Prisma write for this surface.
vi.mock('../utils/gatewayWriteHelpers.js', () => ({
  persistAssistantMessageViaGateway: vi.fn().mockResolvedValue(undefined),
  persistUserMessageViaGateway: vi.fn().mockResolvedValue(undefined),
}));

import {
  persistAssistantMessageViaGateway,
  persistUserMessageViaGateway,
} from '../utils/gatewayWriteHelpers.js';

describe('ConversationPersistence', () => {
  let persistence: ConversationPersistence;
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();
    persistence = new ConversationPersistence();

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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Hello bot!',
        discordMessageId: 'discord-msg-123',
        messageMetadata: undefined, // no references
        messageTime: expect.any(Date),
      });
    });

    it('should pass Discord message createdAt as the row timestamp', async () => {
      // Regression test: the row's createdAt must be the Discord post time, not
      // the DB insert time — otherwise the assistant row (userMessageTime + 1ms)
      // could predate the user row, reversing the turn-pair ordering.
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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith(
        expect.objectContaining({ messageTime: discordPostTime })
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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: null,
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: '[no text content]',
        discordMessageId: 'discord-msg-123',
        messageMetadata: undefined,
        messageTime: expect.any(Date),
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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Check this image\n\n[Placeholder: 1 attachment(s)]',
        discordMessageId: 'discord-msg-123',
        messageMetadata: undefined, // no references
        messageTime: expect.any(Date),
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

      // Content should NOT contain references — they go in messageMetadata
      expect(persistUserMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Replying to [Reference 1]', // Just the text, no reference content
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
        messageTime: expect.any(Date),
      });
    });

    it('carries authorRole through to the stored reference snapshot', async () => {
      // The classify-once link: bot-client classified the role; convertToStoredReferences
      // must persist it so the stored-history quote renders the same role as the live one.
      // Deleting `authorRole: ref.authorRole` there would make this assertion fail.
      const mockMessage = createMockMessage({
        id: 'discord-msg-role',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'ref-role-1',
          discordUserId: 'user-456',
          authorUsername: 'somebot',
          authorDisplayName: 'SomeBot',
          content: 'automated output',
          embeds: '',
          timestamp: '2025-01-01T10:00:00Z',
          locationContext: 'Test Guild > #general',
          authorRole: 'bot',
        },
      ];

      await persistence.saveUserMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        messageContent: 'Replying to [Reference 1]',
        referencedMessages,
      });

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          messageMetadata: {
            referencedMessages: [expect.objectContaining({ authorRole: 'bot' })],
          },
        })
      );
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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Forwarded content',
        discordMessageId: 'discord-msg-fwd',
        messageMetadata: { isForwarded: true },
        messageTime: expect.any(Date),
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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith(
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

      expect(persistUserMessageViaGateway).toHaveBeenCalledWith(
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
      expect(persistUserMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Image with reference\n\n[Placeholder: 1 attachment(s)]', // Attachments in content
        discordMessageId: 'discord-msg-123',
        messageMetadata: {
          referencedMessages: expect.any(Array), // References in metadata
        },
        messageTime: expect.any(Date),
      });
    });

    it('propagates gateway write failures to the caller', async () => {
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
    it('sends userMessageTime to the gateway (the +1ms assistant time is derived gateway-side)', async () => {
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
    });

    it('propagates gateway write failures to the caller', async () => {
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

      expect(persistAssistantMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'channel-123',
        guildId: 'guild-123',
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'Long response that was chunked',
        chunkMessageIds: ['chunk-1', 'chunk-2', 'chunk-3'],
        userMessageTime,
      });
    });

    it('should not save if no chunk message IDs', async () => {
      const mockMessage = createMockMessage({
        id: 'discord-msg-123',
        channelId: 'channel-123',
        guildId: 'guild-123',
      });

      await persistence.saveAssistantMessage({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-uuid-123',
        content: 'Response',
        chunkMessageIds: [],
        userMessageTime: new Date('2025-01-01T10:00:00.000Z'),
      });

      expect(persistAssistantMessageViaGateway).not.toHaveBeenCalled();
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

      expect(persistAssistantMessageViaGateway).toHaveBeenCalledWith({
        channelId: 'dm-channel-123',
        guildId: null,
        personalityId: 'personality-123',
        personaId: 'persona-uuid-123',
        content: 'DM response',
        chunkMessageIds: ['chunk-1'],
        userMessageTime,
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
