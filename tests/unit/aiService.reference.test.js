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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('What do you think about this?');
      expect(textContent.text).toContain('SomeUser said');
      expect(textContent.text).toContain('I believe AI has both benefits and risks');
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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain('Please elaborate on that');
      expect(textContent.text).toContain('You said earlier');
      expect(textContent.text).toContain('The concept of artificial intelligence raises profound philosophical questions');
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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("What's wrong with this message?");
      
      // Should include the reference
      expect(textContent.text).toContain("SomeUser said");
      
      // With minimal sanitization, newlines are preserved but control chars are removed
      expect(textContent.text.includes('\n')).toBe(true); // newlines preserved
      expect(textContent.text.includes('\u0000')).toBe(false); // control chars still removed
      expect(textContent.text.includes('\u0001')).toBe(false); // control chars still removed
      
      // The message should contain the word quotes (escaping syntax depends on implementation)
      expect(textContent.text.includes('quotes')).toBe(true);
      
      // The message should contain the word backslashes (escaping syntax depends on implementation)
      expect(textContent.text.includes('backslashes')).toBe(true);
      
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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role with multimodal content
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should have text element with combined user message and reference
      const textItem = result[0].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain('Tell me about this image');
      expect(textItem.text).toContain('ImagePoster said');
      
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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role with multimodal content
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should have text element with combined user message and reference
      const textItem = result[0].content.find(item => item.type === 'text');
      expect(textItem).toBeDefined();
      expect(textItem.text).toContain("What's in this recording?");
      expect(textItem.text).toContain('AudioPoster said');
      
      // Should have audio part with the URL from the reference
      const audioItem = result[0].content.find(item => item.type === 'audio_url');
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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("Tell me more about that");
      expect(textContent.text).toContain("You said earlier");
      expect(textContent.text).toContain("I am an AI assistant with many capabilities");
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
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text element containing both user content and reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("What do you think about that?");
      expect(textContent.text).toContain("Albert Einstein");
      expect(textContent.text).toContain("Time is relative to the observer");
    });

    it('should handle user self-references with first person format', () => {
      const input = {
        messageContent: "Actually, let me clarify that point",
        referencedMessage: {
          content: "I think AI has some limitations we should consider.",
          author: "CurrentUser",
          isFromBot: false
        },
        userName: "CurrentUser"
      };
      
      const result = formatApiMessages(input);
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text element containing both user content and self-reference
      expect(Array.isArray(result[0].content)).toBe(true);
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("Actually, let me clarify that point");
      expect(textContent.text).toContain("I said:");
      expect(textContent.text).toContain("I think AI has some limitations we should consider");
      expect(textContent.text).not.toContain("CurrentUser said:");
    });

    it('should handle user self-references with audio (scenario 3.2)', () => {
      const input = {
        messageContent: "Let me try this again with better context:",
        referencedMessage: {
          content: "[Audio Message] [Audio: https://example.com/my-audio.mp3]",
          author: "CurrentUser",
          isFromBot: false
        },
        userName: "CurrentUser"
      };
      
      const result = formatApiMessages(input);
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text and audio elements
      expect(Array.isArray(result[0].content)).toBe(true);
      expect(result[0].content.length).toBe(2);
      
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("Let me try this again with better context:");
      expect(textContent.text).toContain("audio from me");
      expect(textContent.text).toContain("I said:");
      expect(textContent.text).toContain("[Audio Message]");
      expect(textContent.text).not.toContain("CurrentUser said:");
      
      const audioContent = result[0].content.find(item => item.type === 'audio_url');
      expect(audioContent).toBeDefined();
      expect(audioContent.audio_url.url).toBe("https://example.com/my-audio.mp3");
    });

    it('should handle user self-references with audio (scenario 5.2)', () => {
      const input = {
        messageContent: "Let me add more context to this audio",
        referencedMessage: {
          content: "[Audio Message] [Audio: https://example.com/my-recording.mp3]",
          author: "CurrentUser",
          isFromBot: false
        },
        userName: "CurrentUser"
      };
      
      const result = formatApiMessages(input);
      
      // Should have one combined message with all content
      expect(result.length).toBe(1);
      
      // Single message should be from user role
      expect(result[0].role).toBe('user');
      
      // Message content should be an array with text and audio elements
      expect(Array.isArray(result[0].content)).toBe(true);
      expect(result[0].content.length).toBe(2);
      
      const textContent = result[0].content.find(item => item.type === 'text');
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("Let me add more context to this audio");
      expect(textContent.text).toContain("audio from me");
      expect(textContent.text).toContain("I said:");
      expect(textContent.text).toContain("[Audio Message]");
      expect(textContent.text).not.toContain("CurrentUser said:");
      
      const audioContent = result[0].content.find(item => item.type === 'audio_url');
      expect(audioContent).toBeDefined();
      expect(audioContent.audio_url.url).toBe("https://example.com/my-recording.mp3");
    });
  });
});