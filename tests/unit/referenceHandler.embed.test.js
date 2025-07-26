/**
 * Tests for embed media extraction in referenceHandler's processMessageLinks
 */

jest.mock('../../src/logger');
jest.mock('../../src/core/conversation');
jest.mock('../../src/utils/embedUtils');

const logger = require('../../src/logger');
const { parseEmbedsToText, extractMediaFromEmbeds } = require('../../src/utils/embedUtils');
const referenceHandler = require('../../src/handlers/referenceHandler');
const { processMessageLinks } = referenceHandler;

describe('processMessageLinks - Embed Media Extraction', () => {
  let mockMessage;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock message
    mockMessage = {
      id: 'msg-123',
      guild: { id: '123456789012345678' },
      channel: { id: '234567890123456789' },
      reference: null,
    };

    // Mock logger
    logger.debug.mockImplementation(() => {});
    logger.info.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should extract image URL from embed in linked message', async () => {
    // Mock parseEmbedsToText to return embed text
    parseEmbedsToText.mockReturnValue('\n[Embed Title: u/onederstand360 on r/Lumity]');

    // Mock extractMediaFromEmbeds to return an image URL
    extractMediaFromEmbeds.mockReturnValue({
      imageUrl: 'https://i.redd.it/example-image.jpg',
      audioUrl: null,
      hasImage: true,
      hasAudio: false,
    });

    // Set up mock client that returns a message with embeds
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
                      content: 'https://www.reddit.com/r/Lumity/s/CUJvjpOTfv',
                      author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                      webhookId: null,
                      attachments: new Map(),
                      embeds: [
                        {
                          title: 'u/onederstand360 on r/Lumity',
                          image: { url: 'https://i.redd.it/example-image.jpg' },
                        },
                      ],
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
      'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
      null,
      false,
      null,
      '@TestPersonality',
      mockClient,
      false
    );

    // Verify the result
    expect(result.messageContent).toContain('[Discord message link]');
    expect(result.referencedImageUrl).toBe('https://i.redd.it/example-image.jpg');
    expect(result.referencedMessageContent).toContain(
      '[Embed Title: u/onederstand360 on r/Lumity]'
    );
    expect(result.referencedMessageContent).toContain(
      '[Image: https://i.redd.it/example-image.jpg]'
    );

    // Verify the functions were called
    expect(parseEmbedsToText).toHaveBeenCalledWith(
      [
        {
          title: 'u/onederstand360 on r/Lumity',
          image: { url: 'https://i.redd.it/example-image.jpg' },
        },
      ],
      'linked message'
    );
    expect(extractMediaFromEmbeds).toHaveBeenCalledWith([
      {
        title: 'u/onederstand360 on r/Lumity',
        image: { url: 'https://i.redd.it/example-image.jpg' },
      },
    ]);
  });

  test('should prioritize audio from embeds over images', async () => {
    parseEmbedsToText.mockReturnValue('\n[Embed Title: Audio Embed]');
    extractMediaFromEmbeds.mockReturnValue({
      imageUrl: 'https://example.com/thumbnail.jpg',
      audioUrl: 'https://example.com/audio.mp3',
      hasImage: true,
      hasAudio: true,
    });

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
                      content: 'Check out this audio',
                      author: { username: 'TestUser', bot: false, id: 'test-user-id' },
                      webhookId: null,
                      attachments: new Map(),
                      embeds: [
                        {
                          title: 'Audio Embed',
                          thumbnail: { url: 'https://example.com/thumbnail.jpg' },
                          description: 'Audio: https://example.com/audio.mp3',
                        },
                      ],
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
      'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
      null,
      false,
      null,
      '@TestPersonality',
      mockClient,
      false
    );

    expect(result.referencedAudioUrl).toBe('https://example.com/audio.mp3');
    expect(result.referencedImageUrl).toBe('https://example.com/thumbnail.jpg');
    expect(result.referencedMessageContent).toContain('[Audio: https://example.com/audio.mp3]');
    expect(result.referencedMessageContent).toContain('[Image: https://example.com/thumbnail.jpg]');
  });

  test('should not extract media from embeds for personality messages', async () => {
    parseEmbedsToText.mockReturnValue('\n[Embed Title: Personality Embed]');
    extractMediaFromEmbeds.mockReturnValue({
      imageUrl: 'https://example.com/personality-image.jpg',
      audioUrl: null,
      hasImage: true,
      hasAudio: false,
    });

    // Mock getPersonalityFromMessage to return a personality
    const { getPersonalityFromMessage } = require('../../src/core/conversation');
    getPersonalityFromMessage.mockReturnValue('test-personality');

    // Legacy personalityManager removed - would use DDD PersonalityApplicationService now

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
                      content: 'Personality message with embed',
                      author: { username: 'TestPersonality', bot: true },
                      webhookId: 'webhook-123',
                      attachments: new Map(),
                      embeds: [
                        {
                          title: 'Personality Embed',
                          image: { url: 'https://example.com/personality-image.jpg' },
                        },
                      ],
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
      'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890',
      null,
      false,
      null,
      '@TestPersonality',
      mockClient,
      false
    );

    // Should parse embed text but not extract media
    expect(parseEmbedsToText).toHaveBeenCalled();
    expect(extractMediaFromEmbeds).not.toHaveBeenCalled();
    expect(result.referencedImageUrl).toBe(null);
    expect(result.referencedMessageContent).toContain('[Embed Title: Personality Embed]');
    expect(result.referencedMessageContent).not.toContain('[Image:');
  });
});
