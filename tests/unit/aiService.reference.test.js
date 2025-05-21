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
      
      // Should have one message combining the reference and user content
      expect(result.length).toBe(1);
      
      // Message should be user role with both the reference and the question
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain('Referring to message from SomeUser');
      expect(result[0].content).toContain('I believe AI has both benefits and risks');
      expect(result[0].content).toContain('What do you think about this?');
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
      
      // Should have one message combining the reference and user content
      expect(result.length).toBe(1);
      
      // Message should be user role with both the reference and the question
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain('Referring to my previous message');
      expect(result[0].content).toContain('The concept of artificial intelligence raises profound philosophical questions');
      expect(result[0].content).toContain('Please elaborate on that');
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
      
      // Should have one message that combines the reference and question
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      const content = result[0].content;
      
      // Should include both the reference and the question
      expect(content).toContain("Referring to message from SomeUser");
      expect(content).toContain("What's wrong with this message?");
      
      // With minimal sanitization, newlines are preserved but control chars are removed
      expect(content.includes('\n')).toBe(true); // newlines preserved
      expect(content.includes('\u0000')).toBe(false); // control chars still removed
      expect(content.includes('\u0001')).toBe(false); // control chars still removed
      
      // The message should contain the word quotes (escaping syntax depends on implementation)
      expect(content.includes('quotes')).toBe(true);
      
      // The message should contain the word backslashes (escaping syntax depends on implementation)
      expect(content.includes('backslashes')).toBe(true);
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
      
      // Should have one message with multimodal content
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Result should be a multimodal content array
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should have text part with reference and user message
      const textItem = result[0].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain('Referring to message from ImagePoster');
      expect(textItem.text).toContain('Check out this picture');
      expect(textItem.text).toContain('Tell me about this image');
      
      // Should have image part with the URL from the reference
      const imageItem = result[0].content.find(item => item.type === 'image_url');
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
      
      // Should have one message with multimodal content
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Result should be a multimodal content array
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should have text part with reference and user message
      const textItem = result[0].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain('Referring to message from AudioPoster');
      expect(textItem.text).toContain('Listen to this');
      expect(textItem.text).toContain("What's in this recording?");
      
      // Should have audio part with the URL from the reference
      const audioItem = result[0].content.find(item => item.type === 'audio_url');
      expect(audioItem).toBeDefined();
      expect(audioItem.audio_url.url).toBe('https://example.com/audio.mp3');
    });
  });
});