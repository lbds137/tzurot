/**
 * Tests for the remove command handler
 * Standardized format using mock factories
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

describe('Remove Command', () => {
  let removeCommand;
  let mockMessage;
  let mockEmbed;
  let mockValidator;
  let mockPersonalityManager;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Create mock instances with proper naming
    const factories = require('../../../utils/mockFactories');
    mockValidator = factories.createValidatorMock();
    mockPersonalityManager = factories.createPersonalityManagerMock();
    
    // Mock specific dependencies that the command uses directly
    jest.mock('../../../../src/commands/utils/commandValidator', () => mockValidator);
    jest.mock('../../../../src/personalityManager', () => mockPersonalityManager);
    
    // Import mocked dependencies now that they're set up
    const logger = require('../../../../src/logger');
    const { EmbedBuilder } = require('discord.js');
    
    // Set up logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    
    // Set up EmbedBuilder mock
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ title: 'Personality Removed' }),
    };
    EmbedBuilder.mockImplementation(() => mockEmbed);
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    
    // Create our spy for directSend to see if it's called
    mockDirectSendFunction = jest.fn().mockImplementation(content => {
      return Promise.resolve({
        id: 'direct-sent-123',
        content: typeof content === 'string' ? content : 'embed message' 
      });
    });
    
    mockValidator.createDirectSend.mockReturnValue(mockDirectSendFunction);
    
    // Import the command module after setting up all mocks
    removeCommand = require('../../../../src/commands/handlers/remove');
  });
  
  it('should have the correct metadata', () => {
    expect(removeCommand.meta).toEqual({
      name: 'remove',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.arrayContaining(['delete']),
      permissions: expect.any(Array)
    });
  });
  
  it('should require a personality name', async () => {
    await removeCommand.execute(mockMessage, []);
    
    // Verify the direct send function was created
    expect(mockValidator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify error message was sent about missing personality name
    expect(mockDirectSendFunction).toHaveBeenCalled();
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