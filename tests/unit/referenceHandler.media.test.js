/**
 * Tests for media marker extraction in referenceHandler's processMessageLinks
 */

// Mock dependencies first
jest.mock('../../src/logger');
jest.mock('../../src/core/conversation');
jest.mock('../../src/utils/embedUtils');

// Now require the modules
const logger = require('../../src/logger');
const { parseEmbedsToText } = require('../../src/utils/embedUtils');

// We need to test the actual implementation, not a mock
const referenceHandler = require('../../src/handlers/referenceHandler');
const { processMessageLinks } = referenceHandler;

describe('processMessageLinks - Media Marker Extraction', () => {
  let mockMessage;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock message
    mockMessage = {
      id: 'msg-123',
      guild: { id: '123456789012345678' },
      channel: { id: '234567890123456789' },
      reference: null, // No reference for this test
    };

    // Mock parseEmbedsToText to return empty string
    parseEmbedsToText.mockReturnValue('');

    // Mock logger to see debug output
    logger.debug.mockImplementation((...args) => console.log('DEBUG:', ...args));
    logger.info.mockImplementation((...args) => console.log('INFO:', ...args));
    logger.error.mockImplementation((...args) => console.log('ERROR:', ...args));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Image marker extraction', () => {
    test('should extract image URL from [Image: url] marker in linked message', async () => {
      // Set up mock client that returns a message with image marker
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content:
                          'Check out this cool image!\n[Image: https://example.com/embed-image.jpg]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map(), // No direct attachments
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      // Process a message with a Discord link
      const result = await processMessageLinks(
        mockMessage,
        'Here is a link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality', // triggeringMention to ensure link is processed
        mockClient,
        false
      );

      // Verify the result
      expect(result.messageContent).toContain('[Discord message link]'); // Link was replaced
      expect(result.referencedImageUrl).toBe('https://example.com/embed-image.jpg');
      expect(result.referencedMessageContent).toContain('Check out this cool image!');
      expect(result.referencedMessageContent).toContain(
        '[Image: https://example.com/embed-image.jpg]'
      );
    });

    test('should extract multiple image markers but only return the first', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content:
                          '[Image: https://example.com/image1.jpg]\n[Image: https://example.com/image2.jpg]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map(),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      expect(result.referencedImageUrl).toBe('https://example.com/image1.jpg'); // First one
      expect(result.referencedMessageContent).toContain('[Image: https://example.com/image1.jpg]');
      expect(result.referencedMessageContent).toContain('[Image: https://example.com/image2.jpg]');
    });
  });

  describe('Audio marker extraction', () => {
    test('should extract audio URL from [Audio: url] marker in linked message', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content: 'Listen to this!\n[Audio: https://example.com/embed-audio.mp3]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map(),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      expect(result.referencedAudioUrl).toBe('https://example.com/embed-audio.mp3');
      expect(result.referencedMessageContent).toContain('Listen to this!');
      expect(result.referencedMessageContent).toContain(
        '[Audio: https://example.com/embed-audio.mp3]'
      );
    });
  });

  describe('Mixed media markers', () => {
    test('should prioritize audio over image when both markers exist', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content:
                          '[Image: https://example.com/image.jpg]\n[Audio: https://example.com/audio.mp3]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map(),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      expect(result.referencedAudioUrl).toBe('https://example.com/audio.mp3');
      expect(result.referencedImageUrl).toBe('https://example.com/image.jpg'); // Both are set
      expect(result.referencedMessageContent).toContain('[Image: https://example.com/image.jpg]');
      expect(result.referencedMessageContent).toContain('[Audio: https://example.com/audio.mp3]');
    });

    test('should combine direct attachments with media markers', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content: 'Multiple media!\n[Image: https://example.com/embed-image.jpg]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map([
                          [
                            'attach-123',
                            {
                              contentType: 'audio/mp3',
                              url: 'https://example.com/direct-audio.mp3',
                            },
                          ],
                        ]),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      expect(result.referencedAudioUrl).toBe('https://example.com/direct-audio.mp3'); // Direct attachment takes priority
      expect(result.referencedImageUrl).toBe('https://example.com/embed-image.jpg'); // From marker
      expect(result.referencedMessageContent).toContain(
        '[Audio: https://example.com/direct-audio.mp3]'
      );
      expect(result.referencedMessageContent).toContain(
        '[Image: https://example.com/embed-image.jpg]'
      );
    });
  });

  describe('Edge cases', () => {
    test('should handle malformed media markers gracefully', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content:
                          '[Image: ] [Audio: no-url-here] [Image: https://valid.com/image.jpg]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map(),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      expect(result.referencedImageUrl).toBe('https://valid.com/image.jpg'); // Only valid URL extracted
      expect(result.referencedAudioUrl).toBe('no-url-here'); // Function extracts any text between brackets
    });

    test('should not extract media markers from personality messages', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content:
                          'Personality message\n[Image: https://example.com/personality-image.jpg]',
                        author: { username: 'TestPersonality', bot: true },
                        webhookId: 'webhook-123', // This is a personality webhook
                        attachments: new Map(),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      // Mock getPersonalityFromMessage to return a personality
      const { getPersonalityFromMessage } = require('../../src/core/conversation');
      getPersonalityFromMessage.mockReturnValue('test-personality');

      // Legacy personalityManager removed - would use DDD PersonalityApplicationService now

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      expect(result.referencedImageUrl).toBe(null); // Should not extract from personality messages
      expect(result.referencedAudioUrl).toBe(null);
      expect(result.referencedPersonalityInfo).toEqual({
        name: 'test-personality',
        displayName: 'test', // DDD system uses simple name extraction when personality not found
      });
    });

    test('should avoid duplicate media markers in content', async () => {
      mockClient = {
        user: { id: 'bot-user-id' },
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue({
                    isTextBased: jest.fn().mockReturnValue(true),
                    messages: {
                      fetch: jest.fn().mockResolvedValue({
                        id: '345678901234567890',
                        content: '[Image: https://example.com/image.jpg]',
                        author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                        webhookId: null,
                        attachments: new Map([
                          [
                            'img-123',
                            {
                              contentType: 'image/jpeg',
                              url: 'https://example.com/image.jpg', // Same URL as in marker
                            },
                          ],
                        ]),
                        embeds: [],
                        channel: {
                          isDMBased: jest.fn().mockReturnValue(false),
                        },
                      }),
                    },
                  }),
                },
              },
            }),
          },
        },
      };

      const result = await processMessageLinks(
        mockMessage,
        'Link: https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
        null,
        false,
        null,
        '@TestPersonality',
        mockClient,
        false
      );

      expect(result.messageContent).toContain('[Discord message link]'); // Link was processed
      // Check that the URL was extracted correctly
      expect(result.referencedImageUrl).toBe('https://example.com/image.jpg');
      // The marker should appear in the content (original content already has it)
      expect(result.referencedMessageContent).toContain('[Image: https://example.com/image.jpg]');
    });
  });
});
