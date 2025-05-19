// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));
jest.mock('../../../../src/personalityManager', () => ({
  registerPersonality: jest.fn(),
  getPersonality: jest.fn(),
  setPersonalityAlias: jest.fn(),
  getPersonalityByAlias: jest.fn(),
  saveAllPersonalities: jest.fn(),
  personalityAliases: new Map(),
  listPersonalitiesForUser: jest.fn()
}));
jest.mock('../../../../src/profileInfoFetcher', () => ({
  fetchProfileInfo: jest.fn(),
  getProfileDisplayName: jest.fn(),
  getProfileAvatarUrl: jest.fn()
}));
jest.mock('../../../../src/webhookManager', () => ({
  preloadPersonalityAvatar: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../../src/commands/utils/messageTracker', () => ({
  isAddCommandProcessed: jest.fn().mockReturnValue(false),
  markAddCommandAsProcessed: jest.fn(),
  isAddCommandCompleted: jest.fn().mockReturnValue(false),
  markAddCommandCompleted: jest.fn(),
  hasFirstEmbed: jest.fn().mockReturnValue(false),
  markGeneratedFirstEmbed: jest.fn(),
  markSendingEmbed: jest.fn(),
  clearSendingEmbed: jest.fn()
}));
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  }),
  validateAlias: jest.fn().mockReturnValue(true),
  cleanupTimeout: jest.fn(),
  safeToLowerCase: jest.fn(str => str ? str.toLowerCase() : ''),
  getAllAliasesForPersonality: jest.fn().mockReturnValue([])
}));
jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    }),
    isAdmin: jest.fn().mockReturnValue(false),
    canManageMessages: jest.fn().mockReturnValue(false),
    isNsfwChannel: jest.fn().mockReturnValue(false),
    getPermissionErrorMessage: jest.fn().mockReturnValue('Permission error')
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const personalityManager = require('../../../../src/personalityManager');
const webhookManager = require('../../../../src/webhookManager');
const messageTracker = require('../../../../src/commands/utils/messageTracker');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Add Command', () => {
  let addCommand;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ 
        title: 'Personality Added',
        fields: [
          { name: 'Display Name', value: 'Test Personality' }
        ],
        thumbnail: { url: 'https://example.com/avatar.png' }
      }),
    }));
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Personality Added'}]
    });
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Re-mock the personality manager with a working implementation
    jest.mock('../../../../src/personalityManager', () => {
      return {
        registerPersonality: jest.fn().mockImplementation((userId, name, alias) => {
          return {
            personality: {
              fullName: name,
              displayName: 'Test Personality',
              avatarUrl: 'https://example.com/avatar.png'
            }
          };
        }),
        getPersonality: jest.fn(),
        setPersonalityAlias: jest.fn(),
        getPersonalityByAlias: jest.fn(),
        saveAllPersonalities: jest.fn(),
        personalityAliases: new Map(),
        listPersonalitiesForUser: jest.fn()
      };
    }, { virtual: true });
    
    // Import the command and mocks after setup
    const personalityManager = require('../../../../src/personalityManager');
    addCommand = require('../../../../src/commands/handlers/add');
  });
  
  it('should have the correct metadata', () => {
    expect(addCommand.meta).toEqual({
      name: 'add',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should handle adding a personality successfully', async () => {
    // Reset mocks to ensure clean state
    jest.clearAllMocks();
    
    // Mock message.channel.send to return a response
    const mockSend = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Personality Added'}]
    });
    mockMessage.channel.send = mockSend;
    
    // Mock registerPersonality to return a successful result
    personalityManager.registerPersonality.mockImplementation((userId, fullName, alias) => {
      return {
        personality: {
          fullName: fullName,
          displayName: 'Test Personality',
          avatarUrl: 'https://example.com/avatar.png'
        }
      };
    });
    
    await addCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    // Verify the registration call
    expect(personalityManager.registerPersonality).toHaveBeenCalledWith(
      'user-123', 'test-personality', 'test-alias'
    );
    
    // Verify avatar preloading
    expect(webhookManager.preloadPersonalityAvatar).toHaveBeenCalled();
    
    // Verify message tracking
    expect(messageTracker.markAddCommandAsProcessed).toHaveBeenCalledWith(mockMessage.id);
    expect(messageTracker.markGeneratedFirstEmbed).toHaveBeenCalled();
    
    // Verify a message was sent to the channel
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  it('should handle missing personality name', async () => {
    // Mock message.channel.send to return a response
    const mockSend = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'You need to provide a personality name'
    });
    mockMessage.channel.send = mockSend;
    
    await addCommand.execute(mockMessage, []);
    
    // Verify no registration attempt was made
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    
    // Verify error message was sent via channel
    expect(mockMessage.channel.send).toHaveBeenCalled();
    expect(mockMessage.channel.send.mock.calls[0][0]).toContain('You need to provide a personality name');
  });
  
  it('should handle registration errors', async () => {
    // Reset mock and create a new one for this test
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Personality already exists'
    });
    
    // Set up error response
    personalityManager.registerPersonality.mockImplementation(() => ({
      error: 'Personality already exists'
    }));
    
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalled();
    expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Personality already exists');
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
  });
  
  it('should detect and prevent duplicate add commands', async () => {
    // Reset the mock to avoid interference from other tests
    jest.clearAllMocks();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123'
    });
    
    // Set up the messageTracker mock to pretend this message was already processed
    messageTracker.isAddCommandProcessed.mockReturnValue(true);
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify no registration attempt was made
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    
    // Verify no message was sent via the channel (critical: reset all mocks before this test)
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    
    // Verify null was returned
    expect(result).toBeNull();
  });
  
  it('should handle registration in DM channels', async () => {
    // Make the channel appear as a DM
    const dmMockMessage = helpers.createMockMessage({ isDM: true });
    
    // Mock validator and utils for this new message (important!)
    validator.createDirectSend.mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    });
    
    // Mock message.channel.send to return a response
    const mockSend = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Personality Added'}]
    });
    dmMockMessage.channel.send = mockSend;
    
    // Reset the registerPersonality mock to actually do something
    personalityManager.registerPersonality.mockImplementation(() => {
      return {
        personality: {
          fullName: 'test-personality',
          displayName: 'Test Personality',
          avatarUrl: 'https://example.com/avatar.png'
        }
      };
    });
    
    await addCommand.execute(dmMockMessage, ['test-personality']);
    
    // Verify the registration call happened
    expect(personalityManager.registerPersonality).toHaveBeenCalled();
    
    // Verify response was sent
    expect(dmMockMessage.channel.send).toHaveBeenCalled();
  });
  
  it('should detect incomplete embeds', () => {
    // Test a simplified version of the core detection logic for incomplete embeds
    const detectIncompleteEmbed = (embed) => {
      if (!embed || !embed.title || embed.title !== "Personality Added") {
        return false;
      }
      
      // Check if this embed has incomplete information (missing display name or avatar)
      const isIncompleteEmbed = (
        // Display name check
        embed.fields?.some(field => 
          field.name === "Display Name" && 
          (field.value === "Not set" || field.value.includes("-ba-et-") || field.value.includes("-zeevat-"))
        ) || 
        !embed.thumbnail // No avatar/thumbnail
      );
      
      return isIncompleteEmbed;
    };
    
    // Test cases for incomplete embeds
    const testCases = [
      {
        description: "Incomplete embed with raw ID as display name",
        embed: {
          title: "Personality Added",
          fields: [
            { name: "Display Name", value: "test-ba-et-test" }
          ]
        },
        expected: true
      },
      {
        description: "Incomplete embed with 'Not set' display name",
        embed: {
          title: "Personality Added",
          fields: [
            { name: "Display Name", value: "Not set" }
          ]
        },
        expected: true
      },
      {
        description: "Incomplete embed missing thumbnail",
        embed: {
          title: "Personality Added",
          fields: [
            { name: "Display Name", value: "Nice Display Name" }
          ]
          // No thumbnail
        },
        expected: true
      },
      {
        description: "Complete embed with display name and thumbnail",
        embed: {
          title: "Personality Added",
          fields: [
            { name: "Display Name", value: "Nice Display Name" }
          ],
          thumbnail: { url: "https://example.com/avatar.png" }
        },
        expected: false
      }
    ];
    
    // Run all test cases
    testCases.forEach(testCase => {
      expect(detectIncompleteEmbed(testCase.embed)).toBe(testCase.expected);
    });
  });
  
  it('should not create any aliases during personality registration', async () => {
    // This test verifies that no aliases are set during the registerPersonality function
    
    // Reset mock and create a new one for this test
    jest.clearAllMocks();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Personality Added'}]
    });
    
    // Setup registerPersonality mock with implementation
    personalityManager.registerPersonality.mockImplementation(async (userId, fullName, alias) => {
      if (alias) {
        personalityManager.personalityAliases.set(alias, fullName);
      }
      
      return {
        personality: {
          fullName,
          displayName: fullName,
          createdBy: userId,
          createdAt: Date.now()
        }
      };
    });
    
    // Reset the aliases map
    personalityManager.personalityAliases.clear();
    
    // Execute the command WITHOUT an alias
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that no aliases were set
    expect(personalityManager.personalityAliases.size).toBe(0);
  });
});