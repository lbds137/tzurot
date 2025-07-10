describe('AIMessageFormatter - Pluralkit Support', () => {
  let aiMessageFormatter;
  let mockLogger;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    jest.doMock('../../../src/logger', () => mockLogger);
    
    // Mock content sanitizer
    jest.doMock('../../../src/utils/contentSanitizer', () => ({
      sanitizeApiText: jest.fn(text => text) // Pass through for testing
    }));
    
    // Mock getPersonality
    jest.doMock('../../../src/core/personality', () => ({
      getPersonality: jest.fn()
    }));
    
    aiMessageFormatter = require('../../../src/utils/aiMessageFormatter');
  });
  
  describe('formatApiMessages with Pluralkit proxy', () => {
    it('should prepend proxy name to simple text messages', async () => {
      const content = 'Hello from Pluralkit!';
      const personalityName = 'test-personality';
      const userName = 'Lila | System';
      const isProxyMessage = true;
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        userName,
        isProxyMessage
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Lila | System: Hello from Pluralkit!');
      
      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Formatting proxy message - userName: "Lila | System"')
      );
    });
    
    it('should not prepend proxy name when isProxyMessage is false', async () => {
      const content = 'Regular message';
      const personalityName = 'test-personality';
      const userName = 'RegularUser';
      const isProxyMessage = false;
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        userName,
        isProxyMessage
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Regular message');
    });
    
    it('should handle multimodal content with proxy prefix', async () => {
      const content = [
        { type: 'text', text: 'Check out this image!' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
      ];
      const personalityName = 'test-personality';
      const userName = 'Alex | System';
      const isProxyMessage = true;
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        userName,
        isProxyMessage
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toHaveLength(2);
      expect(result[0].content[0].text).toBe('Alex | System: Check out this image!');
      expect(result[0].content[1].type).toBe('image_url');
    });
    
    it('should handle different proxy names to enable headmate differentiation', async () => {
      // First message from Lila
      const result1 = await aiMessageFormatter.formatApiMessages(
        'Hello from Lila',
        'test-personality',
        'Lila | System',
        true
      );
      
      // Second message from Alex
      const result2 = await aiMessageFormatter.formatApiMessages(
        'Hello from Alex',
        'test-personality',
        'Alex | System',
        true
      );
      
      expect(result1[0].content).toBe('Lila | System: Hello from Lila');
      expect(result2[0].content).toBe('Alex | System: Hello from Alex');
      
      // This demonstrates that the AI will see different names for different headmates
    });
    
    it('should not prepend if userName is "a user"', async () => {
      const content = 'Test message';
      const personalityName = 'test-personality';
      const userName = 'a user'; // Default when no username available
      const isProxyMessage = true;
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        userName,
        isProxyMessage
      );
      
      expect(result[0].content).toBe('Test message');
    });
  });
});