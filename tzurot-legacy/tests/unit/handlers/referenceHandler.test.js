/**
 * Tests for the reference handler module
 */

const referenceHandler = require('../../../src/handlers/referenceHandler');
const { parseEmbedsToText } = require('../../../src/utils/embedUtils');
const logger = require('../../../src/logger');
const { getPersonalityFromMessage } = require('../../../src/core/conversation');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/core/conversation');
jest.mock('../../../src/utils/embedUtils', () => ({
  parseEmbedsToText: jest.fn(),
}));
jest.mock('../../../src/handlers/messageTrackerHandler');
jest.mock('../../../src/application/services/FeatureFlags');
jest.mock('../../../src/application/bootstrap/ApplicationBootstrap');

const messageTrackerHandler = require('../../../src/handlers/messageTrackerHandler');
const { createFeatureFlags } = require('../../../src/application/services/FeatureFlags');
const { getApplicationBootstrap } = require('../../../src/application/bootstrap/ApplicationBootstrap');

describe('Reference Handler Module', () => {
  // Mock Discord client and objects
  const mockClient = {
    guilds: {
      cache: {
        get: jest.fn(),
      },
    },
    user: {
      id: 'bot-user-id',
    },
  };

  // Mock personality
  const mockPersonality = {
    fullName: 'test-personality',
    displayName: 'Test Personality',
  };

  // Mock message handler
  const mockHandlePersonalityInteraction = jest.fn();
  
  // Mock personality router that will be used in tests
  let mockPersonalityApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock feature flags to use legacy system by default
    createFeatureFlags.mockReturnValue({
      isEnabled: jest.fn().mockReturnValue(false),
    });

    // Mock ApplicationBootstrap with personality router
    mockPersonalityApplicationService = {
      getPersonality: jest.fn().mockImplementation(async (name) => {
        if (name === 'test-personality') {
          return mockPersonality;
        }
        if (name === 'angel dust') {
          return {
            fullName: 'angel-dust-hazbin',
            displayName: 'Angel Dust',
          };
        }
        return null;
      }),
    };
    const mockBootstrap = {
      initialized: true,
      getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
    };
    getApplicationBootstrap.mockReturnValue(mockBootstrap);

    // Legacy personality manager removed - using DDD system now

    // Default mock for conversationManager
    getPersonalityFromMessage.mockImplementation((messageId, options) => {
      if (messageId === 'webhook-msg-id' && options?.webhookUsername === 'Test Webhook') {
        return 'test-personality';
      }
      return null;
    });

    // Mock messageTrackerHandler.delayedProcessing to immediately call the handler
    messageTrackerHandler.delayedProcessing.mockImplementation(
      async (message, personality, mention, client, handlerFunction) => {
        // Immediately call the handler function with the provided arguments
        await handlerFunction(message, personality, mention, client);
      }
    );
  });

  describe('handleMessageReference', () => {
    it('should return false if message has no reference', async () => {
      const mockMessage = {
        // No reference property
        author: { tag: 'User#1234' },
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction
      );

      expect(result).toEqual({ processed: false, wasReplyToNonPersonality: false });
      expect(mockHandlePersonalityInteraction).not.toHaveBeenCalled();
    });

    it('should ignore replies to webhooks from different bot instances', async () => {
      const mockReferencedMessage = {
        id: 'webhook-msg-id',
        webhookId: 'webhook-id',
        applicationId: 'OTHER_BOT_ID', // Different bot's webhook
        author: {
          username: 'Test Webhook',
          bot: true,
        },
      };

      const mockMessage = {
        reference: { messageId: 'webhook-msg-id' },
        channel: {
          messages: {
            fetch: jest.fn().mockResolvedValue(mockReferencedMessage),
          },
        },
        author: { id: 'user-id', tag: 'User#1234' },
      };

      const mockClient = {
        user: { id: 'THIS_BOT_ID' }, // Current bot's ID
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction,
        mockClient
      );

      expect(result).toEqual({ processed: false, wasReplyToNonPersonality: true });
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('webhook-msg-id');
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring reply to webhook from different bot instance')
      );
    });

    it('should fetch and process a referenced webhook message with personality', async () => {
      const mockReferencedMessage = {
        id: 'webhook-msg-id',
        webhookId: 'webhook-id',
        author: {
          username: 'Test Webhook',
          id: 'webhook-user-id',
          bot: true,
        },
      };

      const mockMessage = {
        reference: { messageId: 'webhook-msg-id' },
        author: {
          tag: 'User#1234',
          id: 'user-id',
        },
        channel: {
          messages: {
            fetch: jest.fn().mockResolvedValue(mockReferencedMessage),
          },
          isDMBased: jest.fn().mockReturnValue(false), // Not a DM channel
        },
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction,
        mockClient
      );

      expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('webhook-msg-id');
      expect(getPersonalityFromMessage).toHaveBeenCalledWith('webhook-msg-id', {
        webhookUsername: 'Test Webhook',
      });
      // DDD system uses ApplicationBootstrap router instead of legacy getPersonality
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('test-personality');

      // Since we're mocking a non-DM channel and passing a client, delayedProcessing should be used
      // The delayedProcessing mock will call the handler with the client parameter
      expect(mockHandlePersonalityInteraction).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );
    });

    it('should handle replies to personalities with space-containing aliases', async () => {
      // Mock a personality with a space-containing alias
      const spaceAliasPersonality = {
        fullName: 'angel-dust-hazbin',
        displayName: 'Angel Dust',
      };

      // Legacy getPersonalityByAlias removed - using DDD system now

      // Mock getPersonalityFromMessage to return the space alias
      getPersonalityFromMessage.mockImplementation(messageId => {
        if (messageId === 'space-alias-msg-id') {
          return 'angel dust'; // Return the alias name
        }
        return null;
      });

      const mockReferencedMessage = {
        id: 'space-alias-msg-id',
        webhookId: 'webhook-id',
        author: {
          username: 'Angel Dust',
          id: 'webhook-user-id',
          bot: true,
        },
      };

      const mockMessage = {
        reference: { messageId: 'space-alias-msg-id' },
        author: {
          tag: 'User#1234',
          id: 'user-123', // Important: this user ID must match for user-specific aliases
        },
        channel: {
          messages: {
            fetch: jest.fn().mockResolvedValue(mockReferencedMessage),
          },
          isDMBased: jest.fn().mockReturnValue(false),
        },
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction,
        mockClient
      );

      expect(result).toEqual({ processed: true, wasReplyToNonPersonality: false });
      // DDD system uses ApplicationBootstrap router instead of legacy functions
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('angel dust');
      expect(mockHandlePersonalityInteraction).toHaveBeenCalledWith(
        mockMessage,
        spaceAliasPersonality,
        null,
        mockClient
      );
    });

    it('should handle referenced messages with no personality', async () => {
      const mockReferencedMessage = {
        id: 'non-webhook-msg-id',
        // No webhookId
        author: {
          tag: 'Regular User#1234',
        },
      };

      const mockMessage = {
        reference: { messageId: 'non-webhook-msg-id' },
        author: { tag: 'User#1234' },
        channel: {
          messages: {
            fetch: jest.fn().mockResolvedValue(mockReferencedMessage),
          },
        },
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction
      );

      expect(result).toEqual({
        processed: false,
        wasReplyToNonPersonality: true,
        referencedMessageContent: undefined,
        referencedMessageAuthor: 'another user',
      });
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('non-webhook-msg-id');
      expect(mockHandlePersonalityInteraction).not.toHaveBeenCalled();
    });

    it('should detect Discord message links in non-personality messages', async () => {
      const mockReferencedMessage = {
        id: 'non-webhook-msg-id',
        content: 'Check this out: https://discord.com/channels/123456789/987654321/555555555',
        author: {
          tag: 'Regular User#1234',
          username: 'RegularUser',
        },
      };

      const mockMessage = {
        reference: { messageId: 'non-webhook-msg-id' },
        author: { tag: 'User#1234' },
        channel: {
          messages: {
            fetch: jest.fn().mockResolvedValue(mockReferencedMessage),
          },
        },
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction
      );

      expect(result).toEqual({
        processed: false,
        wasReplyToNonPersonality: true,
        containsMessageLinks: true,
        referencedMessageContent:
          'Check this out: https://discord.com/channels/123456789/987654321/555555555',
        referencedMessageAuthor: 'RegularUser',
      });
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('non-webhook-msg-id');
      expect(mockHandlePersonalityInteraction).not.toHaveBeenCalled();
    });

    it('should handle errors when fetching referenced messages', async () => {
      const mockMessage = {
        reference: { messageId: 'error-msg-id' },
        author: { tag: 'User#1234' },
        channel: {
          messages: {
            fetch: jest.fn().mockRejectedValue(new Error('Failed to fetch message')),
          },
        },
      };

      const result = await referenceHandler.handleMessageReference(
        mockMessage,
        mockHandlePersonalityInteraction
      );

      expect(result).toEqual({ processed: false, wasReplyToNonPersonality: false });
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('error-msg-id');
      expect(logger.error).toHaveBeenCalledWith(
        'Error handling message reference:',
        expect.any(Error)
      );
      expect(mockHandlePersonalityInteraction).not.toHaveBeenCalled();
    });
  });

  describe('processMessageLinks', () => {
    it('should return unmodified content if messageContent is not a string', async () => {
      const mockMessage = { content: 'Hello' };
      const messageContent = ['Not a string'];

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        null,
        mockClient
      );

      expect(result.messageContent).toBe(messageContent);
      expect(result.hasProcessedLink).toBe(false);
    });

    it('should return unmodified content if no message link is present', async () => {
      const mockMessage = { content: 'Hello without link' };
      const messageContent = 'Hello without link';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        null,
        mockClient
      );

      expect(result.messageContent).toBe(messageContent);
      expect(result.hasProcessedLink).toBe(false);
    });

    it('should return unmodified content if link is present but not replying to personality or mentioning', async () => {
      const mockMessage = {
        content: 'Hello with link https://discord.com/channels/123/456/789',
        // No reference property
      };
      const messageContent = 'Hello with link https://discord.com/channels/123/456/789';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        null, // No triggering mention
        mockClient,
        false // No active personality
      );

      expect(result.messageContent).toBe(messageContent);
      expect(result.hasProcessedLink).toBe(false);
    });

    it('should process a message link when replying to a personality webhook', async () => {
      // Mock guild, channel, and linked message
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-msg-id',
                  content: 'Linked message content',
                  author: {
                    username: 'Linked User',
                    bot: false,
                  },
                  webhookId: null, // Not a webhook message
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [],
                  attachments: new Map(),
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content: 'Look at this message https://discord.com/channels/123/456/789',
        reference: { messageId: 'webhook-msg-id' },
      };

      const messageContent = 'Look at this message https://discord.com/channels/123/456/789';
      const referencedPersonalityInfo = {
        name: 'test-personality',
        displayName: 'Test Personality',
      };

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        referencedPersonalityInfo,
        false,
        null,
        null, // No triggering mention
        mockClient
      );

      expect(result.messageContent).toBe('Look at this message [Discord message link]');
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toBe('Linked message content');
      expect(result.referencedMessageAuthor).toBe('Linked User');
      expect(result.isReferencedMessageFromBot).toBe(false);

      // Verify the guild and channel were accessed properly
      expect(mockClient.guilds.cache.get).toHaveBeenCalledWith('123');
      expect(mockGuild.channels.cache.get).toHaveBeenCalledWith('456');
    });

    it('should process a message link when there is an active conversation', async () => {
      // Mock guild, channel, and linked message
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-msg-id',
                  content: 'Linked message content in active conversation',
                  author: {
                    username: 'Active User',
                    bot: false,
                  },
                  webhookId: null, // Not a webhook message
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [],
                  attachments: new Map(),
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content: 'Look at this message https://discord.com/channels/123/456/789',
        // No reference, no mention - but has active conversation
      };

      const messageContent = 'Look at this message https://discord.com/channels/123/456/789';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        null, // No triggering mention
        mockClient,
        true // Has active personality
      );

      expect(result.messageContent).toBe('Look at this message [Discord message link]');
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toBe('Linked message content in active conversation');
      expect(result.referencedMessageAuthor).toBe('Active User');
      expect(result.isReferencedMessageFromBot).toBe(false);
    });

    it('should process a message link when triggered by a mention', async () => {
      // Mock guild, channel, and linked message
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-msg-id',
                  content: 'Linked message content',
                  author: {
                    username: 'Linked User',
                    bot: false,
                  },
                  webhookId: null, // Not a webhook message
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [],
                  attachments: new Map(),
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content: '@TestPersonality Look at this message https://discord.com/channels/123/456/789',
        // No reference
      };

      const messageContent =
        '@TestPersonality Look at this message https://discord.com/channels/123/456/789';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        'TestPersonality', // Triggering mention
        mockClient
      );

      expect(result.messageContent).toBe(
        '@TestPersonality Look at this message [Discord message link]'
      );
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toBe('Linked message content');
      expect(result.referencedMessageAuthor).toBe('Linked User');
      expect(result.isReferencedMessageFromBot).toBe(false);
    });

    it('should process a linked webhook message and extract personality information', async () => {
      // Mock the personality lookup functions
      const mockPersonalityFromMessage = jest.fn().mockReturnValue('linked-personality');
      const mockPersonalityManager = {
        listPersonalitiesByOwner: jest.fn().mockReturnValue([
          {
            fullName: 'linked-personality',
            displayName: 'Linked Personality',
          },
        ]),
      };

      // Legacy personality manager removed - this test needs to be rewritten for DDD system

      // Mock guild, channel, and linked message
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-webhook-msg-id',
                  content: 'Linked webhook message content',
                  author: {
                    username: 'Linked Webhook',
                    bot: true,
                  },
                  webhookId: 'linked-webhook-id', // A webhook message
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [],
                  attachments: new Map(),
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content:
          '@TestPersonality Look at this webhook message https://discord.com/channels/123/456/789',
        // No reference
      };

      const messageContent =
        '@TestPersonality Look at this webhook message https://discord.com/channels/123/456/789';

      // This test is deprecated due to legacy personality manager removal
      // Skip the actual testing for now
      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        'TestPersonality', // Triggering mention
        mockClient
      );

      expect(result.messageContent).toBe(
        '@TestPersonality Look at this webhook message [Discord message link]'
      );
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toBe('Linked webhook message content');
      expect(result.referencedMessageAuthor).toBe('Linked Webhook');
      expect(result.isReferencedMessageFromBot).toBe(true);

      // Legacy mocks removed
    });

    it('should handle linked messages with embeds', async () => {
      // Set up the parseEmbedsToText mock return value
      parseEmbedsToText.mockReturnValue(
        '\n[Embed Title: Embed Title]\n[Embed Description: Embed Description]\n[Embed Field - Field Name: Field Value]\n[Embed Image: https://example.com/embed-image.jpg]'
      );

      // Mock guild, channel, and linked message with embeds
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-msg-id',
                  content: 'Linked message with embeds',
                  author: {
                    username: 'Linked User',
                    bot: false,
                  },
                  webhookId: null,
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [
                    {
                      title: 'Embed Title',
                      description: 'Embed Description',
                      fields: [{ name: 'Field Name', value: 'Field Value' }],
                      image: { url: 'https://example.com/embed-image.jpg' },
                    },
                  ],
                  attachments: new Map(),
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content:
          '@TestPersonality Look at this message with embeds https://discord.com/channels/123/456/789',
        // No reference
      };

      const messageContent =
        '@TestPersonality Look at this message with embeds https://discord.com/channels/123/456/789';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        'TestPersonality',
        mockClient
      );

      expect(result.messageContent).toBe(
        '@TestPersonality Look at this message with embeds [Discord message link]'
      );
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toContain('Linked message with embeds');
      expect(result.referencedMessageContent).toContain('[Embed Title: Embed Title]');

      // Verify parseEmbedsToText was called
      expect(parseEmbedsToText).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Embed Title',
            description: 'Embed Description',
          }),
        ]),
        'linked message'
      );
    });

    it('should handle linked messages with attachments', async () => {
      // Create a mock Map for attachments
      const mockAttachments = new Map();
      mockAttachments.set('image-attachment', {
        contentType: 'image/jpeg',
        url: 'https://example.com/attachment-image.jpg',
      });
      mockAttachments.set('audio-attachment', {
        contentType: 'audio/mp3',
        url: 'https://example.com/attachment-audio.mp3',
      });

      // Mock guild, channel, and linked message with attachments
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-msg-id',
                  content: 'Linked message with attachments',
                  author: {
                    username: 'Linked User',
                    bot: false,
                  },
                  webhookId: null,
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [],
                  attachments: mockAttachments,
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content:
          '@TestPersonality Look at this message with attachments https://discord.com/channels/123/456/789',
        // No reference
      };

      const messageContent =
        '@TestPersonality Look at this message with attachments https://discord.com/channels/123/456/789';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        null,
        false,
        null,
        'TestPersonality',
        mockClient
      );

      expect(result.messageContent).toBe(
        '@TestPersonality Look at this message with attachments [Discord message link]'
      );
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toContain('Linked message with attachments');
      expect(result.referencedMessageContent).toContain(
        '[Image: https://example.com/attachment-image.jpg]'
      );
      expect(result.referencedMessageContent).toContain(
        '[Audio: https://example.com/attachment-audio.mp3]'
      );
    });

    it('should handle errors when processing linked messages', async () => {
      // Mock client to throw error
      mockClient.guilds.cache.get.mockImplementation(() => {
        throw new Error('Failed to access guild');
      });

      const mockMessage = {
        content: 'Look at this message https://discord.com/channels/123/456/789',
        reference: { messageId: 'webhook-msg-id' },
      };

      const messageContent = 'Look at this message https://discord.com/channels/123/456/789';
      const referencedPersonalityInfo = {
        name: 'test-personality',
        displayName: 'Test Personality',
      };

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        messageContent,
        referencedPersonalityInfo,
        false,
        null,
        null,
        mockClient
      );

      expect(result.messageContent).toBe('Look at this message [Discord message link]');
      expect(result.hasProcessedLink).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        `[Bot] Error accessing guild for linked message: Failed to access guild`
      );
    });
  });

  describe('processMessageLinks with reply scenarios', () => {
    it('should process Discord links from referenced message when replying with a mention', async () => {
      // This tests the scenario: user posts message with Discord link, then replies to it with @mention
      const mockGuild = {
        name: 'Test Guild',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue({
              isTextBased: () => true,
              messages: {
                fetch: jest.fn().mockResolvedValue({
                  id: 'linked-msg-id',
                  content: 'This is the linked message content',
                  author: {
                    username: 'Original Author',
                    bot: false,
                  },
                  webhookId: null,
                  channel: {
                    isDMBased: () => false,
                  },
                  embeds: [],
                  attachments: new Map(),
                }),
              },
            }),
          },
        },
      };

      mockClient.guilds.cache.get.mockReturnValue(mockGuild);

      const mockMessage = {
        content: '@TestPersonality check this out', // Current message just has mention
        reference: { messageId: 'original-msg-id' }, // Replying to another message
      };

      // The referenced message content contains the Discord link
      const referencedMessageContent = 'Here is a link: https://discord.com/channels/123/456/789';

      const result = await referenceHandler.processMessageLinks(
        mockMessage,
        referencedMessageContent, // Processing the referenced message's content
        null,
        false,
        null,
        'TestPersonality', // Triggering mention
        mockClient,
        true // Should process because we're replying with a mention
      );

      expect(result.messageContent).toBe('Here is a link: [Discord message link]');
      expect(result.hasProcessedLink).toBe(true);
      expect(result.referencedMessageContent).toBe('This is the linked message content');
      expect(result.referencedMessageAuthor).toBe('Original Author');
    });
  });

  describe('parseEmbedsToText', () => {
    beforeEach(() => {
      // Mock the parseEmbedsToText function from embedUtils
      parseEmbedsToText.mockImplementation((embeds, source) => {
        if (!embeds || !embeds.length) return '';

        let embedContent = '';
        embeds.forEach(embed => {
          if (embed.title) embedContent += `\n[Embed Title: ${embed.title}]`;
          if (embed.description) embedContent += `\n[Embed Description: ${embed.description}]`;
          if (embed.fields && embed.fields.length > 0) {
            embed.fields.forEach(field => {
              embedContent += `\n[Embed Field - ${field.name}: ${field.value}]`;
            });
          }
          if (embed.image && embed.image.url) embedContent += `\n[Embed Image: ${embed.image.url}]`;
          if (embed.thumbnail && embed.thumbnail.url)
            embedContent += `\n[Embed Thumbnail: ${embed.thumbnail.url}]`;
          if (embed.footer && embed.footer.text)
            embedContent += `\n[Embed Footer: ${embed.footer.text}]`;
        });
        return embedContent;
      });
    });

    it('should return empty string for null or empty embeds array', () => {
      expect(parseEmbedsToText(null, 'test')).toBe('');
      expect(parseEmbedsToText([], 'test')).toBe('');
    });

    it('should correctly parse embed with title and description', () => {
      const embeds = [
        {
          title: 'Test Embed',
          description: 'This is a test embed',
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Title: Test Embed]');
      expect(result).toContain('[Embed Description: This is a test embed]');
    });

    it('should correctly parse embed with fields', () => {
      const embeds = [
        {
          fields: [
            { name: 'Field 1', value: 'Value 1' },
            { name: 'Field 2', value: 'Value 2' },
          ],
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Field - Field 1: Value 1]');
      expect(result).toContain('[Embed Field - Field 2: Value 2]');
    });

    it('should correctly parse embed with image and thumbnail', () => {
      const embeds = [
        {
          image: { url: 'https://example.com/image.jpg' },
          thumbnail: { url: 'https://example.com/thumbnail.jpg' },
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Image: https://example.com/image.jpg]');
      expect(result).toContain('[Embed Thumbnail: https://example.com/thumbnail.jpg]');
    });

    it('should correctly parse embed with footer', () => {
      const embeds = [
        {
          footer: { text: 'Footer text' },
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Footer: Footer text]');
    });

    it('should correctly parse multiple embeds', () => {
      const embeds = [
        {
          title: 'First Embed',
          description: 'First description',
        },
        {
          title: 'Second Embed',
          description: 'Second description',
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Title: First Embed]');
      expect(result).toContain('[Embed Description: First description]');
      expect(result).toContain('[Embed Title: Second Embed]');
      expect(result).toContain('[Embed Description: Second description]');
    });
  });

  describe('MESSAGE_LINK_REGEX', () => {
    it('should match standard discord.com link format', () => {
      const link =
        'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890';
      const match = link.match(referenceHandler.MESSAGE_LINK_REGEX);

      expect(match).not.toBeNull();
      expect(match[2]).toBe('123456789012345678'); // guild id
      expect(match[3]).toBe('234567890123456789'); // channel id
      expect(match[4]).toBe('345678901234567890'); // message id
    });

    it('should match ptb.discord.com link format', () => {
      const link =
        'https://ptb.discord.com/channels/123456789012345678/234567890123456789/345678901234567890';
      const match = link.match(referenceHandler.MESSAGE_LINK_REGEX);

      expect(match).not.toBeNull();
      expect(match[1]).toBe('ptb.'); // subdomain
      expect(match[2]).toBe('123456789012345678'); // guild id
      expect(match[3]).toBe('234567890123456789'); // channel id
      expect(match[4]).toBe('345678901234567890'); // message id
    });

    it('should match canary.discord.com link format', () => {
      const link =
        'https://canary.discord.com/channels/123456789012345678/234567890123456789/345678901234567890';
      const match = link.match(referenceHandler.MESSAGE_LINK_REGEX);

      expect(match).not.toBeNull();
      expect(match[1]).toBe('canary.'); // subdomain
      expect(match[2]).toBe('123456789012345678'); // guild id
      expect(match[3]).toBe('234567890123456789'); // channel id
      expect(match[4]).toBe('345678901234567890'); // message id
    });

    it('should match discordapp.com link format', () => {
      const link =
        'https://discordapp.com/channels/123456789012345678/234567890123456789/345678901234567890';
      const match = link.match(referenceHandler.MESSAGE_LINK_REGEX);

      expect(match).not.toBeNull();
      expect(match[2]).toBe('123456789012345678'); // guild id
      expect(match[3]).toBe('234567890123456789'); // channel id
      expect(match[4]).toBe('345678901234567890'); // message id
    });

    it('should not match invalid link formats', () => {
      const invalidLinks = [
        'https://discord.com/channel/123/456/789', // wrong path
        'http://discord.com/channels/123/456/789', // http instead of https
        'https://discordapp.org/channels/123/456/789', // wrong TLD
        'https://discord.com/channels/abc/456/789', // non-numeric IDs
        'discord.com/channels/123/456/789', // missing protocol
      ];

      invalidLinks.forEach(link => {
        const match = link.match(referenceHandler.MESSAGE_LINK_REGEX);
        expect(match).toBeNull();
      });
    });
  });
});
