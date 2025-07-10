describe('AIMessageFormatter - Context Metadata', () => {
  let aiMessageFormatter;
  let mockLogger;
  let formatContextMetadata;
  
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
      sanitizeApiText: jest.fn(text => text)
    }));
    
    // Mock aliasResolver (PersonalityManager removed - now using DDD)
    jest.doMock('../../../src/utils/aliasResolver', () => ({
      resolvePersonality: jest.fn()
    }));
    
    // Mock contextMetadataFormatter
    formatContextMetadata = jest.fn();
    jest.doMock('../../../src/utils/contextMetadataFormatter', () => ({
      formatContextMetadata
    }));
    
    aiMessageFormatter = require('../../../src/utils/aiMessageFormatter');
  });
  
  describe('formatApiMessages with context metadata', () => {
    it('should prepend context metadata to simple text messages', async () => {
      const content = 'Hello world!';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(formatContextMetadata).toHaveBeenCalledWith(mockMessage);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('[Test Server | #general | 2024-07-10T15:30:45.000Z] Hello world!');
    });
    
    it('should prepend context metadata to multimodal content', async () => {
      const content = [
        { type: 'text', text: 'Check this out!' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
      ];
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Cool Server' },
        channel: { type: 0, name: 'images' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Cool Server | #images | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(formatContextMetadata).toHaveBeenCalledWith(mockMessage);
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(2);
      expect(result[0].content[0].text).toBe('[Cool Server | #images | 2024-07-10T15:30:45.000Z] Check this out!');
      expect(result[0].content[1].type).toBe('image_url');
    });
    
    it('should combine context metadata with proxy message prefix', async () => {
      const content = 'Hello from both!';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'Lila | System',
        true,
        mockMessage,
        false
      );
      
      expect(result[0].content).toBe('[Test Server | #general | 2024-07-10T15:30:45.000Z] Lila | System: Hello from both!');
    });
    
    it('should handle DM context metadata', async () => {
      const content = 'DM message';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: null,
        channel: { type: 1 },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[DMs | DMs | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(result[0].content).toBe('[DMs | DMs | 2024-07-10T15:30:45.000Z] DM message');
    });
    
    it('should skip context metadata when disableContextMetadata is true', async () => {
      const content = 'No context please';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        true // disableContextMetadata
      );
      
      expect(formatContextMetadata).not.toHaveBeenCalled();
      expect(result[0].content).toBe('No context please');
    });
    
    it('should skip context metadata when message is null', async () => {
      const content = 'No message object';
      const personalityName = 'test-personality';
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        null,
        false
      );
      
      expect(formatContextMetadata).not.toHaveBeenCalled();
      expect(result[0].content).toBe('No message object');
    });
    
    it('should handle context metadata errors gracefully', async () => {
      const content = 'Error test';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockImplementation(() => {
        throw new Error('Context formatting failed');
      });
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error formatting context metadata: Context formatting failed')
      );
      expect(result[0].content).toBe('Error test'); // Should continue without context
    });
    
    it('should add context metadata to complex reference messages', async () => {
      const content = {
        messageContent: 'Replying to something',
        referencedMessage: {
          content: 'Original message',
          author: 'OriginalUser',
          isFromBot: false,
          authorId: '123',
        }
      };
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(formatContextMetadata).toHaveBeenCalledWith(mockMessage);
      expect(result).toHaveLength(1);
      // The context metadata should be prepended to the combined message
      expect(result[0].content[0].text).toContain('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      expect(result[0].content[0].text).toContain('Replying to something');
    });
  });

  describe('referenced message context metadata', () => {
    it('should add context metadata to referenced messages when enabled', async () => {
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { 
          type: 0, 
          name: 'general',
          parent: { type: 4, name: 'Community' }
        },
        createdTimestamp: 1720625445000
      };
      
      const referencedMessage = {
        content: 'This is the referenced message',
        author: 'Alice',
        isFromBot: false,
        timestamp: 1720621845000, // 1 hour earlier
        channel: mockMessage.channel
      };
      
      const content = {
        messageContent: 'Replying to your message',
        userName: 'Bob',
        userId: '123',
        referencedMessage
      };
      
      // Mock context metadata for current and referenced messages
      // The order in the code is: referenced message first (line 173), then current message (line 308)
      formatContextMetadata
        .mockReturnValueOnce('[Discord: Test Server > Community > #general | 2024-07-10T14:30:45.000Z]') // Referenced message (called first)
        .mockReturnValueOnce('[Discord: Test Server > Community > #general | 2024-07-10T15:30:45.000Z]'); // Current message (called second)
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        'test-personality',
        'Bob',
        false,
        mockMessage,
        false // disableContextMetadata = false
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      
      // For combined messages, content is an array of content objects
      const textContent = result[0].content[0].text;
      // The combined text format is: [current context] current message \n\n [referenced context] referenced content
      expect(textContent).toMatch(/^\[Discord: Test Server > Community > #general \| 2024-07-10T15:30:45\.000Z\] Replying to your message/);
      expect(textContent).toContain('[Discord: Test Server > Community > #general | 2024-07-10T14:30:45.000Z] Alice said:');
      expect(textContent).toContain('"This is the referenced message"');
    });

    it('should skip context metadata for referenced messages when disabled', async () => {
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      const referencedMessage = {
        content: 'This is the referenced message',
        author: 'Alice',
        isFromBot: false,
        timestamp: 1720621845000,
        channel: mockMessage.channel
      };
      
      const content = {
        messageContent: 'Replying to your message',
        userName: 'Bob',
        userId: '123',
        referencedMessage
      };
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        'test-personality',
        'Bob',
        false,
        mockMessage,
        true // disableContextMetadata = true
      );
      
      expect(result).toHaveLength(1);
      
      // For combined messages, content is an array of content objects
      const textContent = result[0].content[0].text;
      expect(textContent).not.toContain('[Discord:');
      expect(textContent).toContain('Replying to your message');
      expect(textContent).toContain('Alice said:\n"This is the referenced message"');
    });

    it('should handle referenced bot messages with context metadata', async () => {
      const mockMessage = {
        guild: { name: 'Cool Server' },
        channel: { 
          type: 11, // Thread
          name: 'help-thread',
          parent: { 
            name: 'support',
            parent: { type: 4, name: 'Help Center' }
          }
        },
        createdTimestamp: 1720625445000
      };
      
      const referencedMessage = {
        content: 'I can help with that!',
        author: 'Assistant Bot',
        isFromBot: true,
        personalityName: 'assistant',
        personalityDisplayName: 'Assistant',
        timestamp: 1720621845000,
        channel: mockMessage.channel
      };
      
      const content = {
        messageContent: 'Thanks for the help!',
        userName: 'Bob',
        userId: '123',
        referencedMessage
      };
      
      // Mock personality resolution
      const aliasResolver = require('../../../src/utils/aliasResolver');
      aliasResolver.resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Assistant' }
      });
      
      // Mock context metadata - referenced message first, then current message
      formatContextMetadata
        .mockReturnValueOnce('[Discord: Cool Server > Help Center > #support > help-thread | 2024-07-10T14:30:45.000Z]') // Referenced message
        .mockReturnValueOnce('[Discord: Cool Server > Help Center > #support > help-thread | 2024-07-10T15:30:45.000Z]'); // Current message
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        'test-personality',
        'Bob',
        false,
        mockMessage,
        false
      );
      
      expect(result).toHaveLength(1);
      
      // For combined messages, content is an array of content objects  
      const textContent = result[0].content[0].text;
      // Current message context should be on "Thanks for the help!"
      expect(textContent).toMatch(/^\[Discord: Cool Server > Help Center > #support > help-thread \| 2024-07-10T15:30:45\.000Z\] Thanks for the help!/);
      // Referenced message context should be on the bot message
      expect(textContent).toContain('[Discord: Cool Server > Help Center > #support > help-thread | 2024-07-10T14:30:45.000Z] Assistant (assistant) said: "I can help with that!"');
    });
  });
});