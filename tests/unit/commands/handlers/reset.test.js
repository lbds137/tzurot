/**
 * Tests for the reset command handler
 * Standardized format for command testing
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));

// Mock dependencies specific to this command
jest.mock('../../../../src/conversationManager', () => ({
  clearConversation: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../../src/personalityManager', () => ({
  getPersonality: jest.fn(),
  getPersonalityByAlias: jest.fn(),
}));

// Mock command validator
jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  createDirectSend: jest.fn(),
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mock dependencies
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');
const conversationManager = require('../../../../src/conversationManager');
const personalityManager = require('../../../../src/personalityManager');

describe('Reset Command', () => {
  let resetCommand;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Set up logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Test response'
    });
    
    // Set up mock direct send function
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Set up validator mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Set up personality manager mocks with default behavior
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(null);
    
    // Import the command module after setting up all mocks
    resetCommand = require('../../../../src/commands/handlers/reset');
  });
  
  it('should have the correct metadata', () => {
    expect(resetCommand.meta).toEqual({
      name: 'reset',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should require a personality name or alias', async () => {
    await resetCommand.execute(mockMessage, []);
    
    // Verify the direct send function was created
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify error message was sent about missing personality name
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain('need to provide a personality name');
  });
  
  it('should reset a conversation by personality name', async () => {
    await resetCommand.execute(mockMessage, ['test-personality']);
    
    // Verify the direct send function was created
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify personality lookups were called in the right order
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id, 
      'test-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    
    // Verify conversation was cleared
    expect(conversationManager.clearConversation).toHaveBeenCalledWith(
      mockMessage.author.id,
      mockMessage.channel.id,
      'test-personality'
    );
    
    // Verify success message was sent
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain('has been reset');
  });
  
  it('should try to find personality by alias first', async () => {
    // Mock getPersonalityByAlias to return a personality this time
    const mockAliasPersonality = {
      fullName: 'alias-personality',
      displayName: 'Alias Personality',
      avatarUrl: 'https://example.com/alias-avatar.png'
    };
    personalityManager.getPersonalityByAlias.mockReturnValue(mockAliasPersonality);
    
    await resetCommand.execute(mockMessage, ['test-alias']);
    
    // Verify alias lookup was attempted
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id, 
      'test-alias'
    );
    
    // Verify full name lookup was NOT attempted (because alias lookup succeeded)
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
    
    // Verify conversation was cleared with the correct personality name
    expect(conversationManager.clearConversation).toHaveBeenCalledWith(
      mockMessage.author.id,
      mockMessage.channel.id,
      'alias-personality'
    );
    
    // Verify success message was sent
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain('has been reset');
  });
  
  it('should handle non-existent personality', async () => {
    // Mock both functions to return null (personality not found)
    personalityManager.getPersonalityByAlias.mockReturnValue(null);
    personalityManager.getPersonality.mockReturnValue(null);
    
    await resetCommand.execute(mockMessage, ['nonexistent-personality']);
    
    // Verify lookups were attempted
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      mockMessage.author.id, 
      'nonexistent-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    
    // Verify conversation was NOT cleared
    expect(conversationManager.clearConversation).not.toHaveBeenCalled();
    
    // Verify error message was sent
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain('not found');
  });
  
  it('should handle errors gracefully', async () => {
    // Mock conversation manager to throw an error
    const testError = new Error('Test error');
    conversationManager.clearConversation.mockImplementation(() => {
      throw testError;
    });
    
    await resetCommand.execute(mockMessage, ['test-personality']);
    
    // Verify error was logged
    expect(logger.error).toHaveBeenCalledWith(
      'Error in handleResetCommand:',
      testError
    );
    
    // Verify error message was sent to user
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain('error occurred');
    expect(mockDirectSend.mock.calls[0][0]).toContain('Test error');
  });
});