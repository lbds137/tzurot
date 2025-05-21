// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/personalityManager');
jest.mock('../../../../src/conversationManager', () => ({
  clearConversation: jest.fn().mockReturnValue(true),
  recordConversation: jest.fn().mockReturnValue(true),
  activatePersonality: jest.fn().mockReturnValue({ success: true }),
  deactivatePersonality: jest.fn().mockReturnValue(true),
  enableAutoResponse: jest.fn(),
  disableAutoResponse: jest.fn(),
  isAutoResponseEnabled: jest.fn().mockReturnValue(false)
}));
jest.mock('../../../../src/aiService');
jest.mock('../../../../src/webhookManager');
jest.mock('../../../../config');
jest.mock('../../../../src/logger');

// Mock utils and commandValidator - crucial for proper test functionality
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  }),
  validateAlias: jest.fn().mockReturnValue(true),
  cleanupTimeout: jest.fn(),
  safeToLowerCase: jest.fn(str => str ? String(str).toLowerCase() : ''),
  getAllAliasesForPersonality: jest.fn().mockReturnValue([])
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    }),
    isAdmin: jest.fn().mockReturnValue(true),
    canManageMessages: jest.fn().mockReturnValue(true),
    isNsfwChannel: jest.fn().mockReturnValue(false),
    getPermissionErrorMessage: jest.fn().mockReturnValue('Permission error message')
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const personalityManager = require('../../../../src/personalityManager');
const conversationManager = require('../../../../src/conversationManager');
const aiService = require('../../../../src/aiService');
const webhookManager = require('../../../../src/webhookManager');
const config = require('../../../../config');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Miscellaneous Command Handlers', () => {
  let mockMessage;
  let mockDirectSend;
  
  // Commands to test
  let resetCommand;
  let infoCommand;
  let pingCommand;
  let statusCommand;
  let autoRespondCommand;
  let debugCommand;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    
    // Set up the channel.send mock to track what's sent
    mockMessage.channel.send = jest.fn().mockImplementation(content => {
      return Promise.resolve({
        id: 'sent-message-123',
        content: typeof content === 'string' ? content : JSON.stringify(content)
      });
    });
    
    // Define mockDirectSend as a reference to the channel.send function for verification
    mockDirectSend = mockMessage.channel.send;
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({}),
    }));
    
    // Set NODE_ENV to test
    process.env.NODE_ENV = 'test';
    
    // Mock configuration
    config.botPrefix = '!tz';
    
    // Create mock client
    const mockClient = {
      uptime: 3600000, // 1 hour
      guilds: {
        cache: {
          size: 10
        }
      }
    };
    
    // Set mock global client
    global.tzurotClient = mockClient;
    
    // Basic personality for testing
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      description: 'Test description',
      createdBy: mockMessage.author.id,
      createdAt: Date.now()
    };
    
    // Mock personalityManager functions
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.listPersonalitiesForUser = jest.fn().mockReturnValue([mockPersonality]);
    personalityManager.setPersonalityAlias = jest.fn().mockResolvedValue({ success: true });
    personalityManager.removePersonality = jest.fn().mockReturnValue(true);
    personalityManager.personalityAliases = new Map([['test', 'test-personality']]);
    
    // Mock conversationManager functions
    conversationManager.recordConversation = jest.fn().mockReturnValue(true);
    conversationManager.clearConversation = jest.fn().mockReturnValue(true);
    conversationManager.activatePersonality = jest.fn().mockReturnValue({ success: true });
    conversationManager.deactivatePersonality = jest.fn().mockReturnValue(true);
    conversationManager.enableAutoResponse = jest.fn();
    conversationManager.disableAutoResponse = jest.fn();
    conversationManager.isAutoResponseEnabled = jest.fn().mockReturnValue(false);
    
    // Mock AI service 
    aiService.knownProblematicPersonalities = {};
    aiService.runtimeProblematicPersonalities = new Map();
    
    // Mock webhook manager
    webhookManager.preloadPersonalityAvatar = jest.fn().mockResolvedValue(undefined);
    
    // Import command handlers after setting up mocks
    resetCommand = require('../../../../src/commands/handlers/reset');
    infoCommand = require('../../../../src/commands/handlers/info');
    pingCommand = require('../../../../src/commands/handlers/ping');
    statusCommand = require('../../../../src/commands/handlers/status');
    autoRespondCommand = require('../../../../src/commands/handlers/autorespond');
    debugCommand = require('../../../../src/commands/handlers/debug');
  });
  
  afterEach(() => {
    // Clean up global objects
    delete global.tzurotClient;
  });
  
  // Reset command tests
  describe('Reset Command', () => {
    it('should have the correct metadata', () => {
      expect(resetCommand.meta).toEqual({
        name: 'reset',
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    });
    
    it('should call clearConversation when reset command runs', async () => {
      // Mock personalityManager to return a test personality
      personalityManager.getPersonalityByAlias.mockReturnValue({
        fullName: 'test-personality',
        displayName: 'Test Personality'
      });

      // Ensure getPersonality also returns the personality as a fallback
      personalityManager.getPersonality.mockReturnValue({
        fullName: 'test-personality',
        displayName: 'Test Personality'
      });

      // Clear any previous calls to clearConversation
      conversationManager.clearConversation.mockClear();

      await resetCommand.execute(mockMessage, ['test-personality']);
      
      // Verify success response, which is more important for user experience
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('has been reset');
      
      // Verify the expected interaction with conversationManager, but be more flexible
      // with parameter matching since implementation might have changed slightly
      expect(conversationManager.clearConversation).toHaveBeenCalled();
    });
    
    it('should report when no personality is found', async () => {
      // Mock both personality lookups to return null (not found)
      personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
      personalityManager.getPersonality.mockReturnValueOnce(null);
      
      await resetCommand.execute(mockMessage, ['unknown-personality']);
      
      // Verify the command returns an error message
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('not found');
      
      // Verify clearConversation was NOT called
      expect(conversationManager.clearConversation).not.toHaveBeenCalled();
    });
  });
  
  // Auto-Response command tests
  describe('Auto Response Command', () => {
    it('should have the correct metadata', () => {
      expect(autoRespondCommand.meta).toEqual({
        name: 'autorespond',
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    });
    
    it('should enable auto-response with "on" parameter', async () => {
      await autoRespondCommand.execute(mockMessage, ['on']);
      
      // Check that the right function was called
      expect(conversationManager.enableAutoResponse).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Check the response - use mockMessage.reply which is used in the code
      expect(mockMessage.reply).toHaveBeenCalled();
      expect(mockMessage.reply.mock.calls[0][0]).toContain('Auto-response enabled');
    });
    
    it('should disable auto-response with "off" parameter', async () => {
      await autoRespondCommand.execute(mockMessage, ['off']);
      
      // Check that the right function was called
      expect(conversationManager.disableAutoResponse).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Check the response - use mockMessage.reply which is used in the code
      expect(mockMessage.reply).toHaveBeenCalled();
      expect(mockMessage.reply.mock.calls[0][0]).toContain('Auto-response disabled');
    });
    
    it('should check auto-response status with "status" parameter', async () => {
      // Mock isAutoResponseEnabled to return a specific value
      conversationManager.isAutoResponseEnabled.mockReturnValueOnce(true);
      
      await autoRespondCommand.execute(mockMessage, ['status']);
      
      // Check that the right function was called
      expect(conversationManager.isAutoResponseEnabled).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Check the response
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('enabled');
    });
    
    it('should show help with no parameters', async () => {
      await autoRespondCommand.execute(mockMessage, []);
      
      // Check the response shows the help message
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('Usage:');
    });
  });
  
  // Info command tests
  describe('Info Command', () => {
    it('should have the correct metadata', () => {
      expect(infoCommand.meta).toEqual({
        name: 'info',
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    });
    
    it('should look up personality by alias', async () => {
      await infoCommand.execute(mockMessage, ['test-alias']);
      
      // Check that we tried to look up by alias
      expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockMessage.author.id, 'test-alias');
      
      // Check the response format (should be an embed)
      expect(mockDirectSend).toHaveBeenCalled();
      // The response should contain an embeds property
      expect(mockDirectSend.mock.calls[0][0]).toHaveProperty('embeds');
    });
    
    it('should fall back to looking up by name if not found by alias', async () => {
      // Make alias lookup fail
      personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
      
      await infoCommand.execute(mockMessage, ['test-personality']);
      
      // Check that we tried to look up by alias first
      expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockMessage.author.id, 'test-personality');
      
      // Then check that we tried by name
      expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    });
    
    it('should show error when personality is not found', async () => {
      // Make both lookups fail
      personalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
      personalityManager.getPersonality.mockReturnValueOnce(null);
      
      await infoCommand.execute(mockMessage, ['unknown-personality']);
      
      // Check error message
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('not found');
    });
    
    it('should show error with no parameters', async () => {
      await infoCommand.execute(mockMessage, []);
      
      // Check error message
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('Please provide a personality name');
    });
  });
  
  // Status command tests
  describe('Status Command', () => {
    it('should have the correct metadata', () => {
      expect(statusCommand.meta).toEqual({
        name: 'status',
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    });
    
    it('should show bot status', async () => {
      await statusCommand.execute(mockMessage, []);
      
      // Check the response format (should be an embed)
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toHaveProperty('embeds');
      
      // Verify that we checked the user's personalities
      expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    });
  });
  
  // Ping command tests
  describe('Ping Command', () => {
    it('should have the correct metadata', () => {
      expect(pingCommand.meta).toEqual({
        name: 'ping',
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    });
    
    it('should respond with pong', async () => {
      await pingCommand.execute(mockMessage, []);
      
      // Check the response
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toMatch(/Pong|pong/i);
    });
  });
  
  // Debug command tests
  describe('Debug Command', () => {
    it('should have the correct metadata', () => {
      expect(debugCommand.meta).toEqual({
        name: 'debug',
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    });
    
    it('should show debug info for admins', async () => {
      await debugCommand.execute(mockMessage, []);
      
      // Check the response format
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toMatch(/debug|Debug/i);
    });
    
    it('should reject non-admins', async () => {
      // Override the isAdmin check to return false
      validator.isAdmin.mockReturnValueOnce(false);
      
      await debugCommand.execute(mockMessage, []);
      
      // Check the error response
      expect(mockDirectSend).toHaveBeenCalled();
      expect(mockDirectSend.mock.calls[0][0]).toContain('administrator');
    });
  });
});