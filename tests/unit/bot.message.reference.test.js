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
  
  it('should correctly format referenced messages for the API', () => {
    // Test with text-only referenced message from another user
    const textRefMsg = {
      messageContent: "What do you think about this?",
      referencedMessage: {
        content: "I believe AI will transform society in profound ways.",
        author: "SomeUser",
        isFromBot: false
      }
    };
    
    const formattedTextRef = formatApiMessages(textRefMsg);
    
    // Should have two message objects
    expect(formattedTextRef).toHaveLength(2);
    
    // First message should contain the referenced content (as user role, not system)
    expect(formattedTextRef[0].role).toBe('user');
    expect(formattedTextRef[0].content).toContain('SomeUser');
    expect(formattedTextRef[0].content).toContain('I believe AI will transform society');
    
    // Second message should be user message with the actual question
    expect(formattedTextRef[1].role).toBe('user');
    expect(formattedTextRef[1].content).toBe("What do you think about this?");
  });
  
  it('should correctly format referenced messages from bot/assistant', () => {
    // Test with text-only referenced message from the bot
    const botRefMsg = {
      messageContent: "Can you elaborate on that?",
      referencedMessage: {
        content: "The concept of emergence is fascinating in complex systems.",
        author: "Tzurot",
        isFromBot: true
      }
    };
    
    const formattedBotRef = formatApiMessages(botRefMsg);
    
    // Should have two message objects
    expect(formattedBotRef).toHaveLength(2);
    
    // First message should be an assistant message with the bot's prior response
    expect(formattedBotRef[0].role).toBe('assistant');
    expect(formattedBotRef[0].content).toBe("The concept of emergence is fascinating in complex systems.");
    
    // Second message should be user message with the follow-up question
    expect(formattedBotRef[1].role).toBe('user');
    expect(formattedBotRef[1].content).toBe("Can you elaborate on that?");
  });
  
  it('should correctly handle referenced messages with image content', () => {
    // Test with referenced message containing an image
    const imageRefMsg = {
      messageContent: "What can you tell me about this image?",
      referencedMessage: {
        content: "Check out this picture[Image: https://example.com/image.jpg]",
        author: "ImagePoster",
        isFromBot: false
      }
    };
    
    const formattedImageRef = formatApiMessages(imageRefMsg);
    
    // Should have three message objects (system text context, user image, and user question)
    expect(formattedImageRef.length).toBeGreaterThanOrEqual(2);
    
    // First message should describe the image context (as user role, not system)
    expect(formattedImageRef[0].role).toBe('user');
    expect(formattedImageRef[0].content).toContain('ImagePoster');
    expect(formattedImageRef[0].content).toContain('referencing a message with an image');
    
    // There should be a message containing the image URL
    const hasImageMessage = formattedImageRef.some(msg => 
      msg.role === 'user' && 
      Array.isArray(msg.content) && 
      msg.content.some(item => 
        item.type === 'image_url' && 
        item.image_url.url === 'https://example.com/image.jpg'
      )
    );
    
    expect(hasImageMessage).toBe(true);
    
    // Last message should contain the user's question or media
    const lastMessageIndex = formattedImageRef.length - 1;
    expect(formattedImageRef[lastMessageIndex].role).toBe('user');
    
    // Allow either string content or multimodal content
    if (typeof formattedImageRef[lastMessageIndex].content === 'string') {
      expect(formattedImageRef[lastMessageIndex].content).toBe("What can you tell me about this image?");
    } else {
      // For multimodal content, expect an array with media
      expect(Array.isArray(formattedImageRef[lastMessageIndex].content)).toBe(true);
      
      // Verify it has image content
      const hasImage = formattedImageRef[lastMessageIndex].content.some(item => 
        item.type === 'image_url' && 
        item.image_url?.url?.includes('example.com')
      );
      expect(hasImage).toBe(true);
    }
  });
  
  it('should handle multimodal content in the user message with references', () => {
    // Test with multimodal user message and a reference
    const multimodalMsg = {
      messageContent: [
        { type: 'text', text: 'How does this compare to the earlier image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/new-image.jpg' } }
      ],
      referencedMessage: {
        content: "Here's the first image[Image: https://example.com/old-image.jpg]",
        author: "SomeUser",
        isFromBot: false
      }
    };
    
    const formattedMultimodalRef = formatApiMessages(multimodalMsg);
    
    // Should have at least 3 messages (system context, image from reference, user message with new image)
    expect(formattedMultimodalRef.length).toBeGreaterThanOrEqual(3);
    
    // First message should contain context (as user role, not system)
    expect(formattedMultimodalRef[0].role).toBe('user');
    
    // There should be a message containing the first image
    const hasFirstImage = formattedMultimodalRef.some(msg => 
      Array.isArray(msg.content) && 
      msg.content.some(item => 
        item.type === 'image_url' && 
        item.image_url.url === 'https://example.com/old-image.jpg'
      )
    );
    
    expect(hasFirstImage).toBe(true);
    
    // Last message should be user's multimodal content with new image
    const lastMessage = formattedMultimodalRef[formattedMultimodalRef.length - 1];
    expect(lastMessage.role).toBe('user');
    
    // The multimodal content should be preserved
    expect(Array.isArray(lastMessage.content)).toBe(true);
    expect(lastMessage.content.some(item => item.type === 'text')).toBe(true);
    expect(lastMessage.content.some(item => 
      item.type === 'image_url' && 
      item.image_url.url === 'https://example.com/new-image.jpg'
    )).toBe(true);
  });
  
  it('should handle regular user messages without references', () => {
    // Test with regular text message
    const textMsg = "Hello, how are you?";
    const formattedText = formatApiMessages(textMsg);
    
    // Should have one message
    expect(formattedText).toHaveLength(1);
    expect(formattedText[0].role).toBe('user');
    expect(formattedText[0].content).toBe(textMsg);
    
    // Test with multimodal content array
    const multimodalArray = [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
    ];
    
    const formattedMultimodal = formatApiMessages(multimodalArray);
    
    // Should have one message with multimodal content
    expect(formattedMultimodal).toHaveLength(1);
    expect(formattedMultimodal[0].role).toBe('user');
    expect(formattedMultimodal[0].content).toBe(multimodalArray);
  });
});