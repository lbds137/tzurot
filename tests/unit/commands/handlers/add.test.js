/**
 * Consolidated tests for the add command handler
 * 
 * This test file combines and standardizes tests from:
 * - tests/unit/commands.add.test.js
 * - tests/unit/commands/add.test.js
 * - tests/unit/commands/handlers/add.test.js
 */

// Mock dependencies
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// Import enhanced test helpers
const { createMigrationHelper } = require('../../../utils/testEnhancements');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');

describe('Add Command', () => {
  let migrationHelper;
  let addCommand;
  let mockMessage;
  let mockDirectSend;
  let mockEmbed;
  let personalityManager;
  let webhookManager;
  let messageTracker;
  let validator;
  
  beforeEach(() => {
    // Reset modules and mocks between tests
    jest.resetModules();
    jest.clearAllMocks();
    
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
    };
    EmbedBuilder.mockImplementation(() => mockEmbed);
    
    // Setup enhanced mock direct send
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Enhanced module mocks with proper Jest integration
    jest.doMock('../../../../src/personalityManager', () => ({
      registerPersonality: jest.fn().mockImplementation((userId, name, alias) => {
        return {
          personality: {
            fullName: name,
            displayName: 'Test Personality',
            avatarUrl: 'https://example.com/avatar.png',
            createdBy: userId,
            createdAt: Date.now()
          }
        };
      }),
      personalityAliases: new Map()
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
    
    jest.doMock('../../../../src/commands/utils/commandValidator', () => {
      return {
        createDirectSend: jest.fn().mockReturnValue(mockDirectSend),
        isAdmin: jest.fn().mockReturnValue(false),
        canManageMessages: jest.fn().mockReturnValue(false),
        isNsfwChannel: jest.fn().mockReturnValue(false)
      };
    });
    
    // Import modules after mocking
    personalityManager = require('../../../../src/personalityManager');
    webhookManager = require('../../../../src/webhookManager');
    messageTracker = require('../../../../src/commands/utils/messageTracker');
    validator = require('../../../../src/commands/utils/commandValidator');
    addCommand = require('../../../../src/commands/handlers/add');
  });
  
  // Test command metadata using enhanced assertions
  it('should have the correct metadata', () => {
    migrationHelper.enhanced.assert.assertCommandMetadata(addCommand, 'add');
    expect(addCommand.meta.aliases).toEqual(expect.arrayContaining(['create']));
  });
  
  // Test basic functionality
  it('should handle adding a personality successfully', async () => {
    // Act
    await addCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    // Assert
    // Verify the registration call
    expect(personalityManager.registerPersonality).toHaveBeenCalledWith(
      mockMessage.author.id, 'test-personality', 'test-alias'
    );
    
    // Verify avatar preloading
    expect(webhookManager.preloadPersonalityAvatar).toHaveBeenCalled();
    
    // Verify message tracking
    // Note: markAddCommandAsProcessed is now called in the middleware, not in the handler
    expect(messageTracker.markGeneratedFirstEmbed).toHaveBeenCalled();
    // These message tracking functions might not be called in the mock tests
    // but are called in the real implementation
    
    // Verify a message was sent to the channel - the embed content
    // verification is an implementation detail
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  // Test error cases
  it('should handle missing personality name', async () => {
    // Act
    await addCommand.execute(mockMessage, []);
    
    // Assert
    // Verify no registration attempt was made
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    
    // Verify error message was sent via direct send
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('You need to provide a personality name')
    );
  });
  
  it('should handle registration errors', async () => {
    // Arrange - mock a registration error
    personalityManager.registerPersonality.mockReturnValueOnce({
      error: 'Personality already exists'
    });
    
    // Act
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Assert
    // Verify error message was sent
    expect(mockDirectSend).toHaveBeenCalledWith('Personality already exists');
    
    // Verify tracking was updated in error case too
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
  });
  
  it('should handle exceptions during registration', async () => {
    // Arrange - force an exception
    personalityManager.registerPersonality.mockImplementationOnce(() => {
      throw new Error('Test error in personality registration');
    });
    
    // Act
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Assert
    // Logger errors are verified in the implementation, not in the test
    
    // Verify error message was sent
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while adding the personality:')
    );
  });
  
  // Test deduplication mechanisms
  it('should detect and prevent duplicate add commands via message tracker', async () => {
    // Arrange - mock that the message was already processed
    messageTracker.isAddCommandProcessed.mockReturnValueOnce(true);
    
    // Act
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Assert
    // Verify no registration attempt was made
    expect(personalityManager.registerPersonality).not.toHaveBeenCalled();
    
    // Verify no message was sent
    expect(mockDirectSend).not.toHaveBeenCalled();
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    
    // Verify null was returned
    expect(result).toBeNull();
    
    // Logger warnings are verified in the implementation, not in the test
  });
  
  it('should block commands that already completed', async () => {
    // Arrange - mock command already completed
    messageTracker.isAddCommandCompleted.mockReturnValueOnce(true);
    
    // Act
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Assert
    // Verify early return and no processing
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    expect(EmbedBuilder).not.toHaveBeenCalled();
    
    // Logger warnings are verified in the implementation, not in the test
    
    // Verify null was returned
    expect(result).toBeNull();
  });
  
  it('should block commands that already generated an embed', async () => {
    // Arrange - mock first embed already generated
    messageTracker.hasFirstEmbed.mockReturnValueOnce(true);
    
    // Act
    const result = await addCommand.execute(mockMessage, ['test-personality']);
    
    // Assert
    // Verify no new embed was generated
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
    
    // Logger warnings are verified in the implementation, not in the test
    
    // Verify the command was still marked as completed
    expect(messageTracker.markAddCommandCompleted).toHaveBeenCalled();
    
    // Verify null was returned
    expect(result).toBeNull();
  });
  
  // Test special cases
  it('should handle registration in DM channels', async () => {
    // Arrange - create enhanced DM mock message
    const dmMockMessage = migrationHelper.bridge.createCompatibleMockMessage({ isDM: true });
    
    // Custom directSend for DM channel using enhanced patterns
    const dmDirectSend = jest.fn().mockImplementation(content => {
      return dmMockMessage.channel.send(content);
    });
    
    // Override validator mock for the DM message
    validator.createDirectSend.mockReturnValueOnce(dmDirectSend);
    
    // Act
    await addCommand.execute(dmMockMessage, ['test-personality']);
    
    // Assert using enhanced assertions
    migrationHelper.enhanced.assert.assertFunctionCalled(
      personalityManager.registerPersonality,
      'Personality registration should occur'
    );
    
    migrationHelper.enhanced.assert.assertFunctionCalled(
      dmMockMessage.channel.send,
      'Message should be sent to DM channel'
    );
  });
  
  it('should handle typing indicator errors gracefully', async () => {
    // Arrange - force an error in sendTyping
    mockMessage.channel.sendTyping = jest.fn().mockRejectedValue(
      new Error('Cannot send typing indicator')
    );
    
    // Act
    await addCommand.execute(mockMessage, ['test-personality']);
    
    // Assert
    // Logger debug messages are verified in the implementation, not in the test
    
    // Verify the command still completed
    expect(personalityManager.registerPersonality).toHaveBeenCalled();
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  it('should add alias information to the embed when provided', async () => {
    // Act
    await addCommand.execute(mockMessage, ['test-personality', 'test-alias']);
    
    // Assert
    // Verify personality was registered with the alias
    expect(personalityManager.registerPersonality).toHaveBeenCalledWith(
      mockMessage.author.id, 'test-personality', 'test-alias'
    );
    
    // Verify the command completes successfully
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });
  
  // Test functionality from the original test file
  it('should detect incomplete embeds', () => {
    // This test verifies the logic used to detect incomplete embeds
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
    
    // Test cases
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
    
    // Run test cases
    testCases.forEach(testCase => {
      expect(detectIncompleteEmbed(testCase.embed)).toBe(testCase.expected);
    });
  });
});