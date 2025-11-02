/**
 * Tests for MessageReferenceExtractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageReferenceExtractor } from './MessageReferenceExtractor.js';
import {
  createMockMessage,
  createMockTextChannel,
  createMockUser,
  createMockGuild,
  createMockCollection
} from '../test/mocks/Discord.mock.js';
import type { Client, Message, TextChannel } from 'discord.js';

// Mock the logger
vi.mock('@tzurot/common-types', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

describe('MessageReferenceExtractor', () => {
  let extractor: MessageReferenceExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use 0ms delay for faster tests
    extractor = new MessageReferenceExtractor({
      maxReferences: 10,
      embedProcessingDelayMs: 0
    });
  });

  /**
   * Helper to create a properly configured text channel with all required methods
   */
  function createConfiguredChannel(overrides: any = {}): TextChannel {
    return createMockTextChannel({
      isDMBased: vi.fn(() => false),
      isTextBased: vi.fn(() => true),
      ...overrides
    });
  }

  describe('extractReferences', () => {
    it('should return empty array for message with no references', async () => {
      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(createMockMessage())
        }
      });

      const message = createMockMessage({
        content: 'Hello world',
        reference: null,
        channel: mockChannel
      });

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should extract reply-to reference', async () => {
      // Create referenced message with properly configured channel
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Original message',
        author: createMockUser({ username: 'OriginalUser' }),
        createdAt: new Date('2025-11-02T12:00:00Z'),
        channel: referencedChannel
      });

      // Create channel first
      const mockChannel = createConfiguredChannel({}) as any;

      // Create message with fetchReference mock
      const message = createMockMessage({
        id: 'msg-123',
        content: 'Reply message',
        channel: mockChannel,
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage)
      });

      // Configure channel to return this message when fetched
      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message)
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('OriginalUser');
      expect(references[0].content).toBe('Original message');
    });

    it('should extract message link reference', async () => {
      const linkedChannel = createConfiguredChannel({});
      const linkedMessage = createMockMessage({
        id: 'linked-456',
        content: 'Linked message content',
        author: createMockUser({ username: 'LinkedUser' }),
        channel: linkedChannel
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(linkedMessage)
        }
      });

      guild.channels = {
        cache: createMockCollection([
          [linkTargetChannel.id, linkTargetChannel]
        ])
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([
            [guild.id, guild]
          ])
        }
      } as any as Client;

      const message = createMockMessage({
        content: 'Check this https://discord.com/channels/123/456/789',
        reference: null,
        client
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('LinkedUser');
    });

    it('should extract both reply and link references', async () => {
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Original',
        author: createMockUser({ username: 'User1' }),
        channel: referencedChannel
      });

      const linkedChannel = createConfiguredChannel({});
      const linkedMessage = createMockMessage({
        id: 'linked-456',
        content: 'Linked',
        author: createMockUser({ username: 'User2' }),
        channel: linkedChannel
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(linkedMessage)
        }
      });

      guild.channels = {
        cache: createMockCollection([
          [linkTargetChannel.id, linkTargetChannel]
        ])
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([
            [guild.id, guild]
          ])
        }
      } as any as Client;

      const message = createMockMessage({
        content: 'Check https://discord.com/channels/123/456/789',
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
        client
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(2);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('User1');
      expect(references[1].referenceNumber).toBe(2);
      expect(references[1].authorUsername).toBe('User2');
    });

    it('should limit references to maxReferences', async () => {
      extractor = new MessageReferenceExtractor({
        maxReferences: 2,
        embedProcessingDelayMs: 0
      });

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        content: 'Referenced',
        author: createMockUser({ username: 'User1' }),
        channel: referencedChannel
      });

      const linkedChannel = createConfiguredChannel({});
      const linkedMessages = [
        createMockMessage({ content: 'Link 1', author: createMockUser({ username: 'User2' }), channel: linkedChannel }),
        createMockMessage({ content: 'Link 2', author: createMockUser({ username: 'User3' }), channel: linkedChannel }),
        createMockMessage({ content: 'Link 3', author: createMockUser({ username: 'User4' }), channel: linkedChannel })
      ];

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn()
            .mockResolvedValueOnce(linkedMessages[0])
            .mockResolvedValueOnce(linkedMessages[1])
            .mockResolvedValueOnce(linkedMessages[2])
        }
      });

      guild.channels = {
        cache: createMockCollection([
          [linkTargetChannel.id, linkTargetChannel]
        ])
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]])
        }
      } as any as Client;

      const message = createMockMessage({
        content: 'https://discord.com/channels/123/456/1 https://discord.com/channels/123/456/2 https://discord.com/channels/123/456/3',
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
        client
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(2); // Limited to maxReferences
    });

    it('should skip inaccessible reply references silently', async () => {
      const message = createMockMessage({
        content: 'Reply to deleted message',
        reference: { messageId: 'deleted-123' } as any,
        fetchReference: vi.fn().mockRejectedValue(new Error('Unknown Message'))
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should skip inaccessible guild references silently', async () => {
      const client = {
        guilds: {
          cache: createMockCollection() // Empty - guild not accessible
        }
      } as any as Client;

      const message = createMockMessage({
        content: 'Link to inaccessible guild https://discord.com/channels/999/456/789',
        reference: null,
        client
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should skip inaccessible channel references silently', async () => {
      const guild = createMockGuild({ id: '123' });
      guild.channels = {
        cache: createMockCollection() // Empty - channel not accessible
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]])
        }
      } as any as Client;

      const message = createMockMessage({
        content: 'Link to inaccessible channel https://discord.com/channels/123/999/789',
        reference: null,
        client
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should extract embeds from referenced messages', async () => {
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        content: 'Message with embed',
        channel: referencedChannel,
        embeds: [
          {
            toJSON: () => ({
              title: 'Embed Title',
              description: 'Embed Description'
            })
          }
        ] as any
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'ref-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage)
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].embeds).toContain('Embed Title');
      expect(references[0].embeds).toContain('Embed Description');
    });

    it('should include guild and channel metadata', async () => {
      const guild = createMockGuild({ id: '123', name: 'Test Server' });
      const channel = createConfiguredChannel({ id: '456', name: 'general', guild });

      const referencedMessage = createMockMessage({
        content: 'Message',
        guild,
        channel
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'ref-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage)
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].guildName).toBe('Test Server');
      expect(references[0].channelName).toBe('#general');
    });

    it('should handle DM messages correctly', async () => {
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        content: 'DM message',
        guild: null,
        channel: referencedChannel
      });

      const message = createMockMessage({
        content: 'DM reply',
        guild: null,
        reference: { messageId: 'dm-ref' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage)
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message)
        }
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].guildName).toBe('Direct Messages');
    });
  });

  describe('formatReferencesForPrompt', () => {
    it('should return empty section for no references', () => {
      const result = MessageReferenceExtractor.formatReferencesForPrompt(
        [],
        'Original content'
      );

      expect(result.updatedContent).toBe('Original content');
      expect(result.referenceSection).toBe('');
    });

    it('should format single reference', () => {
      const references = [
        {
          referenceNumber: 1,
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Referenced content',
          embeds: '',
          timestamp: '2025-11-02T12:00:00.000Z',
          guildName: 'Test Server',
          channelName: '#general'
        }
      ];

      const result = MessageReferenceExtractor.formatReferencesForPrompt(
        references,
        'Check out this message'
      );

      expect(result.referenceSection).toContain('[Reference 1]');
      expect(result.referenceSection).toContain('From: Test User (@testuser)');
      expect(result.referenceSection).toContain('Location: Test Server > #general');
      expect(result.referenceSection).toContain('Referenced content');
    });

    it('should format multiple references', () => {
      const references = [
        {
          referenceNumber: 1,
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'First message',
          embeds: '',
          timestamp: '2025-11-02T12:00:00.000Z',
          guildName: 'Server',
          channelName: '#channel1'
        },
        {
          referenceNumber: 2,
          authorUsername: 'user2',
          authorDisplayName: 'User Two',
          content: 'Second message',
          embeds: '',
          timestamp: '2025-11-02T12:01:00.000Z',
          guildName: 'Server',
          channelName: '#channel2'
        }
      ];

      const result = MessageReferenceExtractor.formatReferencesForPrompt(
        references,
        'Multiple refs'
      );

      expect(result.referenceSection).toContain('[Reference 1]');
      expect(result.referenceSection).toContain('User One');
      expect(result.referenceSection).toContain('[Reference 2]');
      expect(result.referenceSection).toContain('User Two');
    });

    it('should include embeds in formatted output', () => {
      const references = [
        {
          referenceNumber: 1,
          authorUsername: 'user',
          authorDisplayName: 'User',
          content: 'Message',
          embeds: '### Embed\n\n## Title\nDescription',
          timestamp: new Date().toISOString(),
          guildName: 'Server',
          channelName: '#channel'
        }
      ];

      const result = MessageReferenceExtractor.formatReferencesForPrompt(
        references,
        'Content'
      );

      expect(result.referenceSection).toContain('### Embed');
      expect(result.referenceSection).toContain('## Title');
    });

    it('should handle messages with no content but embeds', () => {
      const references = [
        {
          referenceNumber: 1,
          authorUsername: 'user',
          authorDisplayName: 'User',
          content: '',
          embeds: '### Embed\n\n## Title',
          timestamp: new Date().toISOString(),
          guildName: 'Server',
          channelName: '#channel'
        }
      ];

      const result = MessageReferenceExtractor.formatReferencesForPrompt(
        references,
        'Content'
      );

      expect(result.referenceSection).toContain('[Reference 1]');
      expect(result.referenceSection).toContain('### Embed');
    });

    it('should format timestamps in ISO format', () => {
      const timestamp = '2025-11-02T15:30:45.000Z';
      const references = [
        {
          referenceNumber: 1,
          authorUsername: 'user',
          authorDisplayName: 'User',
          content: 'Message',
          embeds: '',
          timestamp,
          guildName: 'Server',
          channelName: '#channel'
        }
      ];

      const result = MessageReferenceExtractor.formatReferencesForPrompt(
        references,
        'Content'
      );

      expect(result.referenceSection).toContain('Time: 2025-11-02T15:30:45.000Z');
    });
  });
});
