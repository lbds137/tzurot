const { formatApiMessages, sanitizeApiText } = require('../../src/aiService');

describe('AI Service Reference Message Handling', () => {
  describe('sanitizeApiText', () => {
    it('should handle empty input', () => {
      expect(sanitizeApiText(null)).toBe('');
      expect(sanitizeApiText('')).toBe('');
      expect(sanitizeApiText(undefined)).toBe('');
    });

    it('should pass through long text (sanitization disabled)', () => {
      const longText = 'a'.repeat(2000);
      const result = sanitizeApiText(longText);
      
      // Sanitization disabled - length should be preserved
      expect(result.length).toBe(2000);
    });

    it('should minimally sanitize problematic characters', () => {
      const problematicText = 'Text with "quotes" and \\backslashes\\ and \nnewlines and control chars\u0000\u0001';
      const result = sanitizeApiText(problematicText);
      
      // With sanitization disabled - quotes and backslashes remain unchanged
      expect(result.includes('"')).toBe(true);
      expect(result.includes('\\')).toBe(true);
      
      // Newlines should be preserved
      expect(result.includes('\n')).toBe(true);
      
      // Only null/control chars should be removed
      expect(result.includes('\u0000')).toBe(false);
      expect(result.includes('\u0001')).toBe(false);
    });
  });

  describe('formatApiMessages with referenced messages', () => {
    it('should properly format text-only referenced messages from users', () => {
      const input = {
        messageContent: "What do you think about this?",
        referencedMessage: {
          content: "I believe AI has both benefits and risks.",
          author: "SomeUser",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should have two messages: one for reference and one for user content
      expect(result.length).toBe(2);
      
      // First message should now be the user's message
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain('What do you think about this?');
      
      // Second message should be the reference
      expect(result[1].role).toBe('user');
      expect(result[1].content).toContain('SomeUser said');
      expect(result[1].content).toContain('I believe AI has both benefits and risks');
    });
    
    it('should properly format text-only referenced messages from the bot', () => {
      const input = {
        messageContent: "Please elaborate on that.",
        referencedMessage: {
          content: "The concept of artificial intelligence raises profound philosophical questions.",
          author: "AI Assistant",
          isFromBot: true
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should have two messages: one for reference and one for user content
      expect(result.length).toBe(2);
      
      // First message should now be the user's message
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain('Please elaborate on that');
      
      // Second message will have the role based on personality match
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toContain('the bot');
      expect(result[1].content).toContain('The concept of artificial intelligence raises profound philosophical questions');
    });
    
    it('should handle problematic content in referenced messages', () => {
      const input = {
        messageContent: "What's wrong with this message?",
        referencedMessage: {
          content: "Error message with \"quotes\", \\backslashes\\, \nnewlines\n and control characters\u0000\u0001",
          author: "SomeUser",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should have two messages: one for reference and one for user content
      expect(result.length).toBe(2);
      
      // First message should now be the user's message
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain("What's wrong with this message?");
      
      // Second message should be the reference
      expect(result[1].role).toBe('user');
      const referenceContent = result[1].content;
      
      // Should include the reference
      expect(referenceContent).toContain("SomeUser said");
      
      // With minimal sanitization, newlines are preserved but control chars are removed
      expect(referenceContent.includes('\n')).toBe(true); // newlines preserved
      expect(referenceContent.includes('\u0000')).toBe(false); // control chars still removed
      expect(referenceContent.includes('\u0001')).toBe(false); // control chars still removed
      
      // The message should contain the word quotes (escaping syntax depends on implementation)
      expect(referenceContent.includes('quotes')).toBe(true);
      
      // The message should contain the word backslashes (escaping syntax depends on implementation)
      expect(referenceContent.includes('backslashes')).toBe(true);
      
      // Removed as it's now tested above
    });
    
    it('should handle image references', () => {
      const input = {
        messageContent: "Tell me about this image",
        referencedMessage: {
          content: "Check out this picture [Image: https://example.com/image.jpg]",
          author: "ImagePoster",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should have three messages: user content, reference, and media
      expect(result.length).toBe(3);
      
      // First message should be the user's message
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Tell me about this image');
      
      // Second message should have the reference
      expect(result[1].role).toBe('user');
      expect(typeof result[1].content).toBe('string');
      expect(result[1].content).toContain('ImagePoster said');
      
      // For image messages, the third message is the media content
      expect(result[2].role).toBe('user');
      // The media message has array content with image type
      expect(Array.isArray(result[2].content)).toBe(true);
      
      // Third message should be a multimodal content array
      // It contains the media reference
      
      // Should have text prompt asking about the image
      const textItem = result[2].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain('Please examine this image');
      
      // Should have image part with the URL from the reference
      const imageItem = result[2].content.find(item => item.type === 'image_url');
      expect(imageItem).toBeDefined();
      expect(imageItem.image_url.url).toBe('https://example.com/image.jpg');
    });
    
    it('should handle audio references', () => {
      const input = {
        messageContent: "What's in this recording?",
        referencedMessage: {
          content: "Listen to this [Audio: https://example.com/audio.mp3]",
          author: "AudioPoster",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should have three messages: user content, reference, and media
      expect(result.length).toBe(3);
      
      // First message should be the user's message
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe("What's in this recording?");
      
      // Second message should have the reference
      expect(result[1].role).toBe('user');
      expect(typeof result[1].content).toBe('string');
      expect(result[1].content).toContain('AudioPoster said');
      
      // For audio messages, the third message is the media content
      expect(result[2].role).toBe('user');
      // The media message has array content with audio type
      expect(Array.isArray(result[2].content)).toBe(true);
      
      // Third message should be a multimodal content array
      // It contains the media reference
      
      // Should have text prompt for audio transcript
      const textItem = result[2].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain("Please listen to this audio");
      
      // Should have audio part with the URL from the reference
      const audioItem = result[2].content.find(item => item.type === 'audio_url');
      expect(audioItem).toBeDefined();
      expect(audioItem.audio_url.url).toBe('https://example.com/audio.mp3');
    });
    
    it('should handle references to the same personality', () => {
      const input = {
        messageContent: "Tell me more about that",
        referencedMessage: {
          content: "I am an AI assistant with many capabilities.",
          author: "Albert Einstein",
          isFromBot: true,
          personalityName: "albert-einstein",
          displayName: "Albert Einstein"
        }
      };
      
      // Use the same personality name in the formatApiMessages call
      const result = formatApiMessages(input, "albert-einstein");
      
      // Should have two messages
      expect(result.length).toBe(2);
      
      // First message should be the user's follow-up
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain("Tell me more about that");
      
      // Second message should be assistant role when it's the same personality
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toContain("I said earlier");
      expect(result[1].content).toContain("I am an AI assistant with many capabilities");
    });
    
    it('should handle references to different personalities', () => {
      const input = {
        messageContent: "What do you think about that?",
        referencedMessage: {
          content: "Time is relative to the observer.",
          author: "Albert Einstein",
          isFromBot: true,
          personalityName: "albert-einstein",
          displayName: "Albert Einstein"
        }
      };
      
      // Use a different personality name in the formatApiMessages call
      const result = formatApiMessages(input, "sigmund-freud");
      
      // Should have two messages
      expect(result.length).toBe(2);
      
      // First message should be the user's question
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain("What do you think about that?");
      
      // Second message should be user role when it's a different personality
      expect(result[1].role).toBe('user');
      expect(result[1].content).toContain("Albert Einstein");
      expect(result[1].content).toContain("Time is relative to the observer");
    });
  });
});