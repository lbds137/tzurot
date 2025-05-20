/**
 * Tests for the debug command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis()
  }))
}));

jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

jest.mock('../../../../src/aiService', () => ({
  knownProblematicPersonalities: ['problem-personality-1', 'problem-personality-2'],
  runtimeProblematicPersonalities: new Map([
    ['runtime-problem-1', Date.now()],
    ['runtime-problem-2', Date.now() - 3600000]
  ])
}));

// Mock utils and commandValidator
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  })
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      const directSend = async (content) => {
        return message.channel.send(content);
      };
      return directSend;
    }),
    isAdmin: jest.fn().mockReturnValue(true),
    canManageMessages: jest.fn().mockReturnValue(false),
    isNsfwChannel: jest.fn().mockReturnValue(false)
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const validator = require('../../../../src/commands/utils/commandValidator');
const aiService = require('../../../../src/aiService');

describe('Debug Command', () => {
  let debugCommand;
  let mockMessage;
  let mockEmbed;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage({ isAdmin: true });
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Debug Information' }]
    });
    
    // Set up embed mock
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis()
    };
    EmbedBuilder.mockReturnValue(mockEmbed);
    
    // Import command module after mock setup
    debugCommand = require('../../../../src/commands/handlers/debug');
  });
  
  it('should show usage information when no subcommand is provided', async () => {
    const result = await debugCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify that channel.send was called with usage info
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You need to provide a subcommand')
    );
    
    // Should include available subcommands
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('problems')
    );
  });
  
  it('should show problematic personalities with "problems" subcommand', async () => {
    const result = await debugCommand.execute(mockMessage, ['problems']);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify embed was created with correct title
    expect(EmbedBuilder).toHaveBeenCalled();
    expect(mockEmbed.setTitle).toHaveBeenCalledWith('Problematic Personalities Report');
    
    // Verify embed fields were added for both types of problematic personalities
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({ 
        name: expect.stringContaining('Known Problematic'),
        value: expect.stringMatching(/problem-personality-1.*problem-personality-2/s)
      }),
      expect.objectContaining({ 
        name: expect.stringContaining('Runtime Problematic'),
        value: expect.stringMatching(/runtime-problem-1.*runtime-problem-2/s)
      })
    );
    
    // Verify the message was sent with the embed
    expect(mockMessage.channel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should handle large lists of problematic personalities', async () => {
    // Create a large list of problematic personalities
    const largeList = Array(100).fill().map((_, i) => `problem-${i}`);
    aiService.knownProblematicPersonalities = largeList;
    
    const result = await debugCommand.execute(mockMessage, ['problems']);
    
    // Verify embed fields handle large lists properly
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining(`(${largeList.length})`),
        value: expect.stringContaining('...') // Should truncate long lists
      }),
      expect.any(Object)
    );
  });
  
  it('should show error for unknown subcommand', async () => {
    const result = await debugCommand.execute(mockMessage, ['unknown']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Unknown debug subcommand: `unknown`')
    );
  });
  
  it('should expose correct metadata with administrator permission', () => {
    expect(debugCommand.meta).toBeDefined();
    expect(debugCommand.meta.name).toBe('debug');
    expect(debugCommand.meta.description).toBeTruthy();
    expect(debugCommand.meta.permissions).toContain('ADMINISTRATOR');
  });
});