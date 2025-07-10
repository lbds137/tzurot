// Tests for embed media extraction in aiService

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('node-fetch');

const { formatApiMessages } = require('../../src/aiService');
const logger = require('../../src/logger');

describe('AIService - Embed Media Extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should include embed thumbnail as image attachment when referenced', async () => {
    const input = {
      messageContent: '@TestPersonality is this accurate?',
      userName: 'testuser',
      userId: 'user123',
      referencedMessage: {
        content:
          'https://www.example.com/post/12345\n[Embed Title: Example Post Title]\n[Embed Thumbnail: https://example.com/thumbnail.jpg]',
        author: 'TestAuthor',
        authorId: 'author456',
        isFromBot: false,
        imageUrl: 'https://example.com/thumbnail.jpg', // This should be provided by personalityHandler
      },
    };

    const result = await formatApiMessages(input);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBeInstanceOf(Array);

    // Check that we have both text and image content
    const textContent = result[0].content.find(item => item.type === 'text');
    const imageContent = result[0].content.find(item => item.type === 'image_url');

    expect(textContent).toBeDefined();
    expect(textContent.text).toContain('@TestPersonality is this accurate?');
    expect(textContent.text).toContain('TestAuthor said (with an image):');
    // Should not contain the embed thumbnail text since it's included as actual image
    expect(textContent.text).not.toContain('[Embed Thumbnail:');

    expect(imageContent).toBeDefined();
    expect(imageContent.image_url.url).toBe('https://example.com/thumbnail.jpg');
  });

  test('should include embed image as image attachment when referenced', async () => {
    const input = {
      messageContent: 'What do you think of this?',
      userName: 'testuser',
      userId: 'user123',
      referencedMessage: {
        content:
          'Check out this cool art!\n[Embed Title: Amazing Artwork]\n[Embed Image: https://example.com/art.jpg]',
        author: 'TestUser2',
        authorId: 'testuser2-456',
        isFromBot: false,
        imageUrl: 'https://example.com/art.jpg',
      },
    };

    const result = await formatApiMessages(input);

    expect(result).toHaveLength(1);
    const imageContent = result[0].content.find(item => item.type === 'image_url');

    expect(imageContent).toBeDefined();
    expect(imageContent.image_url.url).toBe('https://example.com/art.jpg');
  });

  test('should prioritize audio over image from embeds', async () => {
    const input = {
      messageContent: 'Listen to this!',
      userName: 'testuser',
      userId: 'user123',
      referencedMessage: {
        content: 'Song link\n[Embed Thumbnail: https://example.com/thumb.jpg]',
        author: 'musician',
        authorId: 'musician123',
        isFromBot: false,
        audioUrl: 'https://example.com/song.mp3',
        imageUrl: 'https://example.com/thumb.jpg',
      },
    };

    const result = await formatApiMessages(input);

    expect(result).toHaveLength(1);
    const audioContent = result[0].content.find(item => item.type === 'audio_url');
    const imageContent = result[0].content.find(item => item.type === 'image_url');

    // Should include audio but not image (API limitation)
    expect(audioContent).toBeDefined();
    expect(audioContent.audio_url.url).toBe('https://example.com/song.mp3');
    expect(imageContent).toBeUndefined();
  });

  test('should fall back to text extraction if media URLs not provided', async () => {
    const input = {
      messageContent: 'Check this out',
      userName: 'testuser',
      userId: 'user123',
      referencedMessage: {
        content: '[Image: https://example.com/oldformat.jpg]',
        author: 'olduser',
        authorId: 'old123',
        isFromBot: false,
        // No imageUrl or audioUrl provided
      },
    };

    const result = await formatApiMessages(input);

    expect(result).toHaveLength(1);
    const imageContent = result[0].content.find(item => item.type === 'image_url');

    expect(imageContent).toBeDefined();
    expect(imageContent.image_url.url).toBe('https://example.com/oldformat.jpg');
  });

  test('should clean embed references from text when media is included', async () => {
    const input = {
      messageContent: "What's this?",
      userName: 'testuser',
      userId: 'user123',
      referencedMessage: {
        content:
          'Link: https://example.com\n[Embed Title: Test]\n[Embed Thumbnail: https://example.com/thumb.jpg]\n[Embed Footer: Example Site]',
        author: 'poster',
        authorId: 'poster123',
        isFromBot: false,
        imageUrl: 'https://example.com/thumb.jpg',
      },
    };

    const result = await formatApiMessages(input);

    const textContent = result[0].content.find(item => item.type === 'text');

    // Should have cleaned embed thumbnail reference but kept other embed info
    expect(textContent.text).toContain('Link: https://example.com');
    expect(textContent.text).toContain('[Embed Title: Test]');
    expect(textContent.text).toContain('[Embed Footer: Example Site]');
    expect(textContent.text).not.toContain('[Embed Thumbnail:');
  });
});
