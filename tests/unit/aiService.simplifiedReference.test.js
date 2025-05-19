const { formatApiMessages } = require('../../src/aiService');

describe('AI Service Simplified Reference Handling', () => {
  describe('formatApiMessages with prepended references', () => {
    it('should prepend referenced message to user content', () => {
      const input = {
        messageContent: "What do you think about this?",
        referencedMessage: {
          content: "I believe AI has both benefits and risks.",
          author: "SomeUser",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should be a single user message with combined content
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Should contain both the reference and user's question
      const content = result[0].content;
      expect(content).toContain("Referring to message from SomeUser");
      expect(content).toContain("I believe AI has both benefits and risks");
      expect(content).toContain("What do you think about this?");
    });
    
    it('should handle bot references differently', () => {
      const input = {
        messageContent: "Tell me more about that.",
        referencedMessage: {
          content: "The future of AI depends on responsible development.",
          author: "AI Assistant",
          isFromBot: true
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should be a single user message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Should use the "my previous message" format for bot references
      const content = result[0].content;
      expect(content).toContain("Referring to my previous message");
      expect(content).toContain("The future of AI depends on responsible development");
      expect(content).toContain("Tell me more about that");
    });
    
    it('should handle image references as multimodal content', () => {
      const input = {
        messageContent: "What's in this image?",
        referencedMessage: {
          content: "Check out this picture [Image: https://example.com/image.jpg]",
          author: "ImagePoster",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should be a single user message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Should be a multimodal content array
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should include both text and image
      const textItem = result[0].content.find(item => item.type === 'text');
      const imageItem = result[0].content.find(item => item.type === 'image_url');
      
      expect(textItem).toBeDefined();
      expect(imageItem).toBeDefined();
      
      // Text should include the reference and user's question
      expect(textItem.text).toContain("Referring to message from ImagePoster");
      expect(textItem.text).toContain("Check out this picture");
      expect(textItem.text).toContain("What's in this image?");
      
      // Image URL should be correct
      expect(imageItem.image_url.url).toBe("https://example.com/image.jpg");
    });
    
    it('should handle audio references as multimodal content', () => {
      const input = {
        messageContent: "What was in that audio?",
        referencedMessage: {
          content: "Listen to this [Audio: https://example.com/audio.mp3]",
          author: "AudioPoster",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should be a single user message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Should be a multimodal content array
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should include both text and audio
      const textItem = result[0].content.find(item => item.type === 'text');
      const audioItem = result[0].content.find(item => item.type === 'audio_url');
      
      expect(textItem).toBeDefined();
      expect(audioItem).toBeDefined();
      
      // Text should include the reference and user's question
      expect(textItem.text).toContain("Referring to message from AudioPoster");
      expect(textItem.text).toContain("Listen to this");
      expect(textItem.text).toContain("What was in that audio?");
      
      // Audio URL should be correct
      expect(audioItem.audio_url.url).toBe("https://example.com/audio.mp3");
    });
    
    it('should prepend reference to existing multimodal content', () => {
      const input = {
        messageContent: [
          { type: 'text', text: "Do these images look similar?" },
          { type: 'image_url', image_url: { url: "https://example.com/my-image.jpg" } }
        ],
        referencedMessage: {
          content: "Check out this picture [Image: https://example.com/reference-image.jpg]",
          author: "ImagePoster",
          isFromBot: false
        }
      };
      
      const result = formatApiMessages(input);
      
      // Should be a single multimodal user message
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
      
      // Should still be a multimodal content array for the original image
      expect(Array.isArray(result[0].content)).toBe(true);
      
      // Should include text and at least one image
      const textItem = result[0].content.find(item => item.type === 'text');
      const imageItem = result[0].content.find(item => item.type === 'image_url');
      
      expect(textItem).toBeDefined();
      expect(imageItem).toBeDefined();
      
      // The text should contain both the reference and the original question
      expect(textItem.text).toContain("Referring to message from ImagePoster");
      expect(textItem.text).toContain("Check out this picture");
      expect(textItem.text).toContain("Do these images look similar?");
      
      // Make sure we have the original image
      expect(imageItem.image_url.url).toBe("https://example.com/my-image.jpg");
      
      // The text should just have the prefix for multimodal content
      // Note: When we have a multimodal array, we don't add image URLs to the text
      expect(textItem.text).not.toContain("Referenced image");
      expect(textItem.text).not.toContain("reference-image.jpg");
    });
  });
});