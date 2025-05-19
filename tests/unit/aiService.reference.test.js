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
      
      // Should have two messages - the reference and the user message
      expect(result.length).toBe(2);
      
      // First message should be user role with the referenced content
      expect(result[0].role).toBe('user');
      expect(result[0].content).toContain('SomeUser');
      expect(result[0].content).toContain('I believe AI has both benefits and risks');
      
      // Second message should be the user's question
      expect(result[1].role).toBe('user');
      expect(result[1].content).toBe("What do you think about this?");
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
      
      // Should have two messages - the reference and the user message
      expect(result.length).toBe(2);
      
      // First message should be assistant role with the referenced content
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('The concept of artificial intelligence raises profound philosophical questions.');
      
      // Second message should be the user's question
      expect(result[1].role).toBe('user');
      expect(result[1].content).toBe("Please elaborate on that.");
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
      
      // First message should be sanitized
      expect(result[0].role).toBe('user');
      const content = result[0].content;
      
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
      
      // Should detect the image and format appropriately
      expect(result.length).toBeGreaterThan(1);
      expect(result[0].content).toContain('previous message with an image');
      
      // Should include the original message content somewhere
      const hasOriginalMessage = result.some(msg => 
        msg.role === 'user' && 
        typeof msg.content === 'string' && 
        (msg.content.includes("Tell me about this image") || 
         msg.content.includes("I'm referring to this"))
      );
      expect(hasOriginalMessage).toBe(true);
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
      
      // Should detect the audio and include it in the user message
      expect(result.length).toBeGreaterThan(0);
      const userReferenceMessage = result.find(msg => msg.role === 'user' && msg.content.includes('audio file'));
      expect(userReferenceMessage.content).toContain('audio file');
      expect(userReferenceMessage.content).toContain('Listen to this');
    });
  });
});