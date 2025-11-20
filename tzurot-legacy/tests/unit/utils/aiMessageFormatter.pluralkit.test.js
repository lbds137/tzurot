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
    
    
    // Mock aliasResolver (PersonalityManager removed - now using DDD)
    jest.doMock('../../../src/utils/aliasResolver', () => ({
      resolvePersonality: jest.fn()
    }));
    
    // Mock context metadata formatter
    jest.doMock('../../../src/utils/contextMetadataFormatter', () => ({
      formatContextMetadata: jest.fn(() => '[Test Server | #test-channel | 2025-01-01T00:00:00.000Z]')
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
      
      // Verify logging - updated to match new format with context metadata
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Formatting message - contextPrefix: ""')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('userName: "Lila | System"')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('isProxyMessage: true')
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