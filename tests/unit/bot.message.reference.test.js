/**
 * Tests for message reference handling in bot conversations
 */

const logger = require('../../src/logger');
const { getAiResponse } = require('../../src/aiService');
const { formatApiMessages } = require('../../src/aiService');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('discord.js');
jest.mock('../../src/webhookManager');

describe('Message Reference Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should correctly format referenced messages for the API', async () => {
    // Test with text-only referenced message from another user
    const textRefMsg = {
      messageContent: 'What do you think about this?',
      referencedMessage: {
        content: 'I believe AI will transform society in profound ways.',
        author: 'SomeUser',
        isFromBot: false,
      },
    };

    const formattedTextRef = await formatApiMessages(textRefMsg);

    // Should have one combined message
    expect(formattedTextRef).toHaveLength(1);

    // Single message should be from user role with multimodal content
    expect(formattedTextRef[0].role).toBe('user');
    expect(Array.isArray(formattedTextRef[0].content)).toBe(true);

    // Find the text content containing both user question and reference
    const textItem = formattedTextRef[0].content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('What do you think about this?');
    expect(textItem.text).toContain('SomeUser');
    expect(textItem.text).toContain('I believe AI will transform society');
  });

  it('should correctly format referenced messages from bot/assistant', async () => {
    // Test with text-only referenced message from the bot
    const botRefMsg = {
      messageContent: 'Can you elaborate on that?',
      referencedMessage: {
        content: 'The concept of emergence is fascinating in complex systems.',
        author: 'Tzurot',
        isFromBot: true,
      },
    };

    const formattedBotRef = await formatApiMessages(botRefMsg);

    // Should have one combined message
    expect(formattedBotRef).toHaveLength(1);

    // Single message should be from user role with multimodal content
    expect(formattedBotRef[0].role).toBe('user');
    expect(Array.isArray(formattedBotRef[0].content)).toBe(true);

    // Find the text content containing both user question and bot reference
    const textItem = formattedBotRef[0].content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('Can you elaborate on that?');
    expect(textItem.text).toContain('The concept of emergence is fascinating in complex systems.');
  });

  it('should correctly handle referenced messages with image content', async () => {
    // Test with referenced message containing an image
    const imageRefMsg = {
      messageContent: 'What can you tell me about this image?',
      referencedMessage: {
        content: 'Check out this picture[Image: https://example.com/image.jpg]',
        author: 'ImagePoster',
        isFromBot: false,
      },
    };

    const formattedImageRef = await formatApiMessages(imageRefMsg);

    // Should have one combined message
    expect(formattedImageRef).toHaveLength(1);

    // Single message should be from user role with multimodal content
    expect(formattedImageRef[0].role).toBe('user');
    expect(Array.isArray(formattedImageRef[0].content)).toBe(true);

    const singleMessage = formattedImageRef[0];

    // Find the text content containing both user question and reference
    const textItem = singleMessage.content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('What can you tell me about this image?');
    expect(textItem.text).toContain('ImagePoster said (with an image):');

    // Find the image content from the reference
    const imageItem = singleMessage.content.find(
      item => item.type === 'image_url' && item.image_url.url === 'https://example.com/image.jpg'
    );
    expect(imageItem).toBeDefined();
  });

  it('should handle multimodal content in the user message with references', async () => {
    // Test with multimodal user message and a reference
    const multimodalMsg = {
      messageContent: [
        { type: 'text', text: 'How does this compare to the earlier image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/new-image.jpg' } },
      ],
      referencedMessage: {
        content: "Here's the first image[Image: https://example.com/old-image.jpg]",
        author: 'SomeUser',
        isFromBot: false,
      },
    };

    const formattedMultimodalRef = await formatApiMessages(multimodalMsg);

    // Should have one combined message
    expect(formattedMultimodalRef).toHaveLength(1);

    // Single message should be from user role with multimodal content
    const singleMessage = formattedMultimodalRef[0];
    expect(singleMessage.role).toBe('user');
    expect(Array.isArray(singleMessage.content)).toBe(true);

    // Find the text content containing both user text and reference
    const textItem = singleMessage.content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('How does this compare to the earlier image?');
    expect(textItem.text).toContain('SomeUser');

    // Find the user's new image
    const userImageItem = singleMessage.content.find(
      item =>
        item.type === 'image_url' && item.image_url.url === 'https://example.com/new-image.jpg'
    );
    expect(userImageItem).toBeDefined();

    // Find the referenced old image
    const refImageItem = singleMessage.content.find(
      item =>
        item.type === 'image_url' && item.image_url.url === 'https://example.com/old-image.jpg'
    );
    expect(refImageItem).toBeDefined();
  });

  it('should handle regular user messages without references', async () => {
    // Test with regular text message
    const textMsg = 'Hello, how are you?';
    const formattedText = await formatApiMessages(textMsg);

    // Should have one message
    expect(formattedText).toHaveLength(1);
    expect(formattedText[0].role).toBe('user');
    expect(formattedText[0].content).toBe(textMsg);

    // Test with multimodal content array
    const multimodalArray = [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
    ];

    const formattedMultimodal = await formatApiMessages(multimodalArray);

    // Should have one message with multimodal content
    expect(formattedMultimodal).toHaveLength(1);
    expect(formattedMultimodal[0].role).toBe('user');
    expect(formattedMultimodal[0].content).toBe(multimodalArray);
  });
});
