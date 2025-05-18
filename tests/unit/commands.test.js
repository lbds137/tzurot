// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../src/personalityManager');
jest.mock('../../src/conversationManager');
jest.mock('../../src/aiService');
jest.mock('../../src/webhookManager');
jest.mock('../../config');

// Import mocked modules
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const personalityManager = require('../../src/personalityManager');
const conversationManager = require('../../src/conversationManager');
const aiService = require('../../src/aiService');
const webhookManager = require('../../src/webhookManager');
const config = require('../../config');

// Mock console methods to reduce test noise
global.console.log = jest.fn();
global.console.warn = jest.fn();
global.console.error = jest.fn();

// Extract the command handler functions for direct testing instead of testing the processCommand API
// This avoids issues with global caching and timeouts
const commandHandlers = {
  // Import the module containing the handler functions
  listHandler: require('../../src/commands').handleListCommand,
  resetHandler: require('../../src/commands').handleResetCommand,
  infoHandler: require('../../src/commands').handleInfoCommand,
  pingResponse: require('../../src/commands').directSend,
  statusHandler: require('../../src/commands').handleStatusCommand,
  activateHandler: require('../../src/commands').handleActivateCommand,
  deactivateHandler: require('../../src/commands').handleDeactivateCommand,
  autoRespondHandler: require('../../src/commands').handleAutoRespondCommand,
  debugHandler: require('../../src/commands').handleDebugCommand
};

// In case the function handlers aren't exported (they likely aren't), 
// we'll fall back to testing the main function with specific focus areas
describe('commands module', () => {
  let mockMessage;
  let mockAuthor;
  let mockChannel;
  let mockMember;
  let mockGuild;
  let mockClient;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock author
    mockAuthor = {
      id: 'user-123',
      tag: 'User#1234'
    };

    // Create mock channel
    mockChannel = {
      id: 'channel-123',
      send: jest.fn().mockResolvedValue({ id: 'sent-message-123' })
    };

    // Create mock guild
    mockGuild = {
      id: 'guild-123'
    };

    // Create mock permissions
    const mockPermissions = {
      has: jest.fn().mockImplementation((flag) => flag === PermissionFlagsBits.Administrator)
    };

    // Create mock member with permissions
    mockMember = {
      permissions: mockPermissions
    };

    // Create mock message
    mockMessage = {
      id: 'message-123',
      author: mockAuthor,
      channel: mockChannel,
      guild: mockGuild,
      member: mockMember,
      reply: jest.fn().mockResolvedValue({ id: 'reply-123' }),
      content: '!tz test'
    };

    // Create mock client
    mockClient = {
      uptime: 3600000, // 1 hour
      guilds: {
        cache: {
          size: 10
        }
      }
    };

    // Set mock global client
    global.tzurotClient = mockClient;

    // Mock configuration
    config.botPrefix = '!tz';

    // Basic personality for testing
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      description: 'Test description',
      createdBy: 'user-123',
      createdAt: Date.now()
    };

    // Mock personalityManager functions
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.listPersonalitiesForUser = jest.fn().mockReturnValue([mockPersonality]);
    personalityManager.setPersonalityAlias = jest.fn().mockResolvedValue({ success: true });
    personalityManager.removePersonality = jest.fn().mockReturnValue(true);
    personalityManager.personalityAliases = { 'test': 'test-personality' };

    // Mock conversationManager functions
    conversationManager.recordConversation = jest.fn().mockReturnValue(true);
    conversationManager.clearConversation = jest.fn().mockReturnValue(true);
    conversationManager.activatePersonality = jest.fn().mockReturnValue(true);
    conversationManager.deactivatePersonality = jest.fn().mockReturnValue(true);
    conversationManager.enableAutoResponse = jest.fn();
    conversationManager.disableAutoResponse = jest.fn();
    conversationManager.isAutoResponseEnabled = jest.fn().mockReturnValue(false);

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

    // Mock AI service 
    aiService.knownProblematicPersonalities = {};
    aiService.runtimeProblematicPersonalities = new Map();

    // Mock webhook manager
    webhookManager.preloadPersonalityAvatar = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Clean up global objects
    delete global.tzurotClient;
  });

  // Direct testing only of the conversationManager integration
  // This focuses on just one specific functionality without dealing with the complex command processor
  describe('Conversation Manager integration', () => {
    it('should call clearConversation when reset command runs', async () => {
      const commands = require('../../src/commands');
      
      // If handleResetCommand is not exported, we can't test it directly,
      // so we'll check its effect indirectly by checking if clearConversation was called
      
      // Run the command via processCommand
      await commands.processCommand(mockMessage, 'reset', []);
      
      // Verify the expected interaction with conversationManager
      expect(conversationManager.clearConversation).toHaveBeenCalledWith(
        mockAuthor.id, mockChannel.id
      );
      
      // Verify the reply was sent with expected content
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(typeof replyContent).toBe('string');
      expect(replyContent).toContain('Conversation history cleared');
    });
    
    it('should report when no conversation to clear', async () => {
      // Mock clearConversation to return false (no conversation to clear)
      conversationManager.clearConversation.mockReturnValueOnce(false);
      
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'reset', []);
      
      // Verify the reply contains the expected content
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(replyContent).toContain('No active conversation');
    });
  });
  
  // Test the Auto-Response functionality
  describe('Auto Response commands', () => {
    it('should enable auto-response with "on" parameter', async () => {
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'autorespond', ['on']);
      
      // Check that the right function was called
      expect(conversationManager.enableAutoResponse).toHaveBeenCalledWith(mockAuthor.id);
      
      // Check the response
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(replyContent).toContain('Auto-response enabled');
    });
    
    it('should disable auto-response with "off" parameter', async () => {
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'autorespond', ['off']);
      
      // Check that the right function was called
      expect(conversationManager.disableAutoResponse).toHaveBeenCalledWith(mockAuthor.id);
      
      // Check the response
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(replyContent).toContain('Auto-response disabled');
    });
    
    it('should check auto-response status with "status" parameter', async () => {
      // Mock isAutoResponseEnabled to return a specific value
      conversationManager.isAutoResponseEnabled.mockReturnValueOnce(true);
      
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'autorespond', ['status']);
      
      // Check that the right function was called
      expect(conversationManager.isAutoResponseEnabled).toHaveBeenCalledWith(mockAuthor.id);
      
      // Check the response
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(replyContent).toContain('enabled');
    });
  });
  
  // Test listing personalities
  describe('Personality listing', () => {
    it('should list user personalities', async () => {
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'list', []);
      
      // Check that we requested the user's personalities
      expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockAuthor.id);
      
      // Check the response format (should be an embed)
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyArgs = mockMessage.reply.mock.calls[0][0];
      expect(replyArgs).toHaveProperty('embeds');
      expect(replyArgs.embeds.length).toBeGreaterThan(0);
    });
    
    it('should handle the case of no personalities', async () => {
      // Mock empty personalities list
      personalityManager.listPersonalitiesForUser.mockReturnValueOnce([]);
      
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'list', []);
      
      // Check the response (no embed, just a text message)
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(typeof replyContent).toBe('string');
      expect(replyContent).toContain('haven\'t added any personalities');
    });
  });
  
  // Test basic info command
  describe('Info command', () => {
    it('should look up personality by alias', async () => {
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'info', ['test-alias']);
      
      // Check that we tried to look up by alias
      expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test-alias');
      
      // Check the response format (should be an embed)
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyArgs = mockMessage.reply.mock.calls[0][0];
      expect(replyArgs).toHaveProperty('embeds');
    });
    
    it('should show error with no parameters', async () => {
      const commands = require('../../src/commands');
      await commands.processCommand(mockMessage, 'info', []);
      
      // Check error message
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0];
      expect(typeof replyContent).toBe('string');
      expect(replyContent).toContain('Please provide a profile name');
    });
  });
});