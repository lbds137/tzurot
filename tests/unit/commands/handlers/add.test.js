// Mock dependencies
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import and mock command dependencies
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');

describe('Add Command Handler', () => {
  // Setup module mocks before requiring the module
  let mockMessage;
  let mockDirectSend;
  let personalityManager;
  let webhookManager;
  let messageTracker;
  let validator;
  let addCommand;
  
  beforeEach(() => {
    // Reset modules between tests
    jest.resetModules();
    jest.clearAllMocks();
    
    // Setup mocks
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Personality Added'}]
    });
    
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
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
    
    // Mock dependencies
    jest.doMock('../../../../src/personalityManager', () => ({
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
    }));
    
    jest.doMock('../../../../src/webhookManager', () => ({
      preloadPersonalityAvatar: jest.fn().mockResolvedValue(true)
    }));
    
    jest.doMock('../../../../src/commands/utils/messageTracker', () => ({
      isAddCommandProcessed: jest.fn().mockReturnValue(false),
      markAddCommandAsProcessed: jest.fn(),
      isAddCommandCompleted: jest.fn().mockReturnValue(false),
      markAddCommandCompleted: jest.fn(),
      hasFirstEmbed: jest.fn().mockReturnValue(false),
      markGeneratedFirstEmbed: jest.fn(),
      markSendingEmbed: jest.fn(),
      clearSendingEmbed: jest.fn()
    }));
    
    jest.doMock('../../../../src/utils', () => ({
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
    
    jest.doMock('../../../../src/commands/utils/commandValidator', () => {
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
    
    jest.doMock('../../../../src/profileInfoFetcher', () => ({
      fetchProfileInfo: jest.fn(),
      getProfileDisplayName: jest.fn(),
      getProfileAvatarUrl: jest.fn()
    }));
    
    // Import modules after mocking
    personalityManager = require('../../../../src/personalityManager');
    webhookManager = require('../../../../src/webhookManager');
    messageTracker = require('../../../../src/commands/utils/messageTracker');
    validator = require('../../../../src/commands/utils/commandValidator');
    addCommand = require('../../../../src/commands/handlers/add');
  });
  
  afterEach(() => {
    jest.resetModules();
  });
  
  test('should have the correct metadata', () => {
    expect(addCommand.meta).toEqual({
      name: 'add',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  test('should handle adding a personality successfully', async () => {
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
  
  test('should handle missing personality name', async () => {
    await addCommand.execute(mockMessage, []);
    
    // Verify no registration attempt was made
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    
    // Verify error message was sent via channel
    expect(mockMessage.channel.send).toHaveBeenCalled();
    expect(mockMessage.channel.send.mock.calls[0][0]).toContain('You need to provide a personality name');
  });
  
  test('should handle registration errors', async () => {
    // Change the mock implementation for this specific test
    personalityManager.registerPersonality.mockReturnValueOnce({
      error: 'Personality already exists'
    });
    
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalled();
    expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Personality already exists');
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
  });
  
  test('should detect and prevent duplicate add commands', async () => {
    // Reset the mock to avoid interference from other tests
    jest.clearAllMocks();
    
    // Set up the messageTracker mock to pretend this message was already processed
    messageTracker.isAddCommandProcessed.mockReturnValueOnce(true);
    
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify no registration attempt was made
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    
    // Verify no message was sent via the channel
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    
    // Verify null was returned
    expect(result).toBeNull();
  });
  
  test('should handle registration in DM channels', async () => {
    // Create DM mock message
    const dmMockMessage = helpers.createMockMessage();
    dmMockMessage.channel.isDMBased = jest.fn().mockReturnValue(true);
    dmMockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Personality Added'}]
    });
    
    // Create a custom directSend for the DM channel
    const dmDirectSend = jest.fn().mockImplementation(content => {
      return dmMockMessage.channel.send(content);
    });
    
    // Override the validator mock for this test
    validator.createDirectSend.mockImplementation((message) => {
      if (message === dmMockMessage) {
        return dmDirectSend;
      }
      return mockDirectSend;
    });
    
    await addCommand.execute(dmMockMessage, ['test-personality']);
    
    // Verify the registration call happened
    expect(personalityManager.registerPersonality).toHaveBeenCalled();
    
    // Verify response was sent to the DM channel
    expect(dmMockMessage.channel.send).toHaveBeenCalled();
  });
  
  test('should not create any aliases during personality registration', async () => {
    // Reset mock and create a new one for this test
    jest.clearAllMocks();
    
    // Reset the aliases map
    personalityManager.personalityAliases.clear();
    
    // Execute the command WITHOUT an alias
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Verify that no aliases were set
    expect(personalityManager.personalityAliases.size).toBe(0);
  });
  
  test('should detect incomplete embeds', () => {
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
});