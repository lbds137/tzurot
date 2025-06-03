/**
 * Tests for the remove command handler
 * Enhanced with migration helper patterns
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  isDevelopment: false,
  APP_ID: 'test-app-id',
  API_KEY: 'test-api-key',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));
jest.mock('../../../../src/profileInfoFetcher', () => ({
  fetchProfileInfo: jest.fn(),
  getProfileAvatarUrl: jest.fn(),
  getProfileDisplayName: jest.fn(),
  deleteFromCache: jest.fn(),
  _testing: {
    clearCache: jest.fn(),
    getCache: jest.fn(),
    setFetchImplementation: jest.fn(),
    getRateLimiter: jest.fn(),
    getFetcher: jest.fn(),
    resetFetcher: jest.fn()
  }
}));

// Import enhanced test helpers
const { createMigrationHelper } = require('../../../utils/testEnhancements');

describe('Remove Command', () => {
  let migrationHelper;
  let removeCommand;
  let mockMessage;
  let mockEmbed;
  let mockValidator;
  let mockPersonalityManager;
  let mockDirectSendFunction;
  
  beforeEach(() => {
    // Reset all mocks and modules
    jest.clearAllMocks();
    jest.resetModules();
    
    // Create migration helper with enhanced patterns
    migrationHelper = createMigrationHelper();
    
    // Setup enhanced mock environment
    const mockEnv = migrationHelper.bridge.getMockEnvironment();
    mockMessage = migrationHelper.bridge.createCompatibleMockMessage();
    
    // Enhanced EmbedBuilder mock
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ title: 'Personality Removed' }),
    };
    const { EmbedBuilder } = require('discord.js');
    EmbedBuilder.mockImplementation(() => mockEmbed);
    
    // Enhanced mock direct send
    mockDirectSendFunction = jest.fn().mockImplementation(content => {
      return Promise.resolve({
        id: 'direct-sent-123',
        content: typeof content === 'string' ? content : 'embed message' 
      });
    });
    
    // Enhanced module mocks with proper Jest integration
    jest.doMock('../../../../src/personalityManager', () => ({
      getPersonality: jest.fn().mockReturnValue({
        fullName: 'test-personality',  
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png'
      }),
      getPersonalityByAlias: jest.fn().mockReturnValue(null),
      removePersonality: jest.fn().mockResolvedValue({
        success: true
      })
    }));
    
    jest.doMock('../../../../src/commands/utils/commandValidator', () => ({
      createDirectSend: jest.fn().mockReturnValue(mockDirectSendFunction),
      isAdmin: jest.fn().mockReturnValue(false),
      canManageMessages: jest.fn().mockReturnValue(false),
      isNsfwChannel: jest.fn().mockReturnValue(false)
    }));
    
    // Setup logger mock
    const logger = require('../../../../src/logger');
    logger.error = jest.fn();
    logger.info = jest.fn();
    
    // Import modules after mocking
    mockPersonalityManager = require('../../../../src/personalityManager');
    mockValidator = require('../../../../src/commands/utils/commandValidator');
    removeCommand = require('../../../../src/commands/handlers/remove');
  });
  
  it('should have the correct metadata', () => {
    migrationHelper.enhanced.assert.assertCommandMetadata(removeCommand, 'remove');
    expect(removeCommand.meta.aliases).toEqual(expect.arrayContaining(['delete']));
  });
  
  it('should require a personality name', async () => {
    await removeCommand.execute(mockMessage, []);
    
    // Verify the direct send function was created using enhanced assertions
    migrationHelper.enhanced.assert.assertFunctionCalledWith(
      mockValidator.createDirectSend, 
      [mockMessage], 
      'Should create direct send function for the message'
    );
    
    // Verify error message was sent about missing personality name
    migrationHelper.enhanced.assert.assertFunctionCalled(
      mockDirectSendFunction,
      'Should send error message for missing personality name'
    );
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('need to provide a personality name');
  });
  
  it('should handle non-existent personality', async () => {
    // Mock personality not found
    mockPersonalityManager.getPersonality.mockReturnValueOnce(null);
    mockPersonalityManager.getPersonalityByAlias.mockReturnValueOnce(null);
    
    await removeCommand.execute(mockMessage, ['nonexistent-personality']);
    
    // Verify personality lookup attempts
    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'nonexistent-personality'
    );
    expect(mockPersonalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    
    // Verify remove was NOT called
    expect(mockPersonalityManager.removePersonality).not.toHaveBeenCalled();
    
    // Verify error message was sent
    expect(mockDirectSendFunction).toHaveBeenCalled();
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('not found');
  });
  
  it('should remove a personality by name', async () => {
    // Import the mocked profileInfoFetcher after other mocks are set up
    const profileInfoFetcher = require('../../../../src/profileInfoFetcher');
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    // Verify personality lookups
    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(mockPersonalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    
    // Verify remove was called with correct parameters
    expect(mockPersonalityManager.removePersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    
    // Verify profile cache was invalidated
    expect(profileInfoFetcher.deleteFromCache).toHaveBeenCalledWith('test-personality');
    
    // Verify embed was created correctly
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Personality Removed');
    expect(mockEmbed.setDescription).toHaveBeenCalledWith(
      expect.stringContaining('Test Personality')
    );
    expect(mockEmbed.setColor).toHaveBeenCalledWith(0xf44336);
    
    // Verify success message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should remove a personality by alias', async () => {
    // Import the mocked profileInfoFetcher after other mocks are set up
    const profileInfoFetcher = require('../../../../src/profileInfoFetcher');
    
    // Set up mock for alias lookup
    const mockPersonality = {
      fullName: 'full-personality-name',
      displayName: 'Display Name',
      avatarUrl: 'https://example.com/alias.png'
    };
    mockPersonalityManager.getPersonalityByAlias.mockReturnValueOnce(mockPersonality);
    
    await removeCommand.execute(mockMessage, ['test-alias']);
    
    // Verify alias lookup
    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-alias'
    );
    
    // Direct name lookup should not happen since alias lookup succeeded
    expect(mockPersonalityManager.getPersonality).not.toHaveBeenCalled();
    
    // Verify remove was called with correct parameters
    expect(mockPersonalityManager.removePersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'full-personality-name'
    );
    
    // Verify profile cache was invalidated with the full name
    expect(profileInfoFetcher.deleteFromCache).toHaveBeenCalledWith('full-personality-name');
    
    // Verify embed was created correctly
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Personality Removed');
    expect(mockEmbed.setDescription).toHaveBeenCalledWith(
      expect.stringContaining('Display Name')
    );
    
    // Verify success message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should handle errors from removePersonality', async () => {
    // Mock error from removePersonality
    mockPersonalityManager.removePersonality.mockResolvedValueOnce({
      error: 'Failed to remove personality'
    });
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    // Verify personality lookups
    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    expect(mockPersonalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    
    // Verify remove was called
    expect(mockPersonalityManager.removePersonality).toHaveBeenCalledWith(
      mockMessage.author.id,
      'test-personality'
    );
    
    // Verify error message was sent
    expect(mockDirectSendFunction).toHaveBeenCalledWith('Failed to remove personality');
  });
  
  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    const testError = new Error('Unexpected error');
    mockPersonalityManager.getPersonalityByAlias.mockImplementationOnce(() => {
      throw testError;
    });
    
    await removeCommand.execute(mockMessage, ['test-personality']);
    
    // Verify error was logged
    const logger = require('../../../../src/logger');
    expect(logger.error).toHaveBeenCalledWith(
      'Error in remove command:',
      testError
    );
    
    // Verify error message was sent to user
    expect(mockDirectSendFunction).toHaveBeenCalled();
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('error occurred');
    expect(mockDirectSendFunction.mock.calls[0][0]).toContain('Unexpected error');
  });
});