// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/personalityManager');
jest.mock('../../../../src/conversationManager');
jest.mock('../../../../src/aiService');
jest.mock('../../../../src/webhookManager');
jest.mock('../../../../config');
jest.mock('../../../../src/commands/utils/commandValidator');
jest.mock('../../../../src/logger');

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
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    validator.isAdmin.mockReturnValue(true);
    
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
      await resetCommand.execute(mockMessage, []);
      
      // Verify the expected interaction with conversationManager
      expect(conversationManager.clearConversation).toHaveBeenCalledWith(
        mockMessage.author.id, mockMessage.channel.id
      );
      
      // Verify success response
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Conversation history cleared'
      });
    });
    
    it('should report when no conversation to clear', async () => {
      // Mock clearConversation to return false (no conversation to clear)
      conversationManager.clearConversation.mockReturnValueOnce(false);
      
      await resetCommand.execute(mockMessage, []);
      
      // Verify the response contains the expected content
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'No active conversation'
      });
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
      
      // Check the response
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Auto-response enabled'
      });
    });
    
    it('should disable auto-response with "off" parameter', async () => {
      await autoRespondCommand.execute(mockMessage, ['off']);
      
      // Check that the right function was called
      expect(conversationManager.disableAutoResponse).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Check the response
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Auto-response disabled'
      });
    });
    
    it('should check auto-response status with "status" parameter', async () => {
      // Mock isAutoResponseEnabled to return a specific value
      conversationManager.isAutoResponseEnabled.mockReturnValueOnce(true);
      
      await autoRespondCommand.execute(mockMessage, ['status']);
      
      // Check that the right function was called
      expect(conversationManager.isAutoResponseEnabled).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Check the response
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'enabled'
      });
    });
    
    it('should show help with no parameters', async () => {
      await autoRespondCommand.execute(mockMessage, []);
      
      // Check the response shows the help message
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Usage:'
      });
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
      helpers.verifySuccessResponse(mockDirectSend, {
        isEmbed: true
      });
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
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'not found'
      });
    });
    
    it('should show error with no parameters', async () => {
      await infoCommand.execute(mockMessage, []);
      
      // Check error message
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'Please provide a personality name'
      });
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
      helpers.verifySuccessResponse(mockDirectSend, {
        isEmbed: true
      });
      
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
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: /Pong|pong/i
      });
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
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: /debug|Debug/
      });
    });
    
    it('should reject non-admins', async () => {
      // Override the isAdmin check to return false
      validator.isAdmin.mockReturnValueOnce(false);
      
      await debugCommand.execute(mockMessage, []);
      
      // Check the error response
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'administrator'
      });
    });
  });
});