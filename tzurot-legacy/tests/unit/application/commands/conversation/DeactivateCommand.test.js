/**
 * @jest-environment node
 * @testType unit
 *
 * DeactivateCommand Test
 * Tests the deactivate command functionality for DDD architecture
 */

const {
  createDeactivateCommand,
} = require('../../../../../src/application/commands/conversation/DeactivateCommand');
const { Command } = require('../../../../../src/application/commands/CommandAbstraction');
const logger = require('../../../../../src/logger');

// Mock dependencies
jest.mock('../../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('DeactivateCommand', () => {
  let command;
  let mockContext;
  let mockConversationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock services
    mockConversationManager = {
      getActivatedPersonality: jest.fn(),
      deactivatePersonality: jest.fn(),
    };

    // Create mock context
    mockContext = {
      args: [],
      options: {},
      userId: '123456789012345678',
      channelId: '987654321098765432',
      guildId: '111222333444555666',
      commandPrefix: '!tz',
      dependencies: {
        conversationManager: mockConversationManager,
      },
      respond: jest.fn(),
      hasPermission: jest.fn(),
      getChannelId: jest.fn().mockReturnValue('987654321098765432'),
      getGuildId: jest.fn().mockReturnValue('111222333444555666'),
      isDM: false,
    };

    // Create the command
    command = createDeactivateCommand();
  });

  describe('command metadata', () => {
    it('should have correct metadata', () => {
      expect(command.name).toBe('deactivate');
      expect(command.description).toBe(
        'Deactivate the currently active personality in this channel'
      );
      expect(command.category).toBe('Conversation');
      expect(command.aliases).toEqual(['deact']);
      expect(command.options).toHaveLength(0);
    });
  });

  describe('execute', () => {
    it('should deactivate an active personality', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(true);
      mockConversationManager.getActivatedPersonality.mockReturnValue('Aria');

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockConversationManager.getActivatedPersonality).toHaveBeenCalledWith(
        mockContext.channelId
      );
      expect(mockConversationManager.deactivatePersonality).toHaveBeenCalledWith(
        mockContext.channelId
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Deactivated',
            description: expect.stringContaining('**Aria** has been deactivated'),
            color: 0x00ff00,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Deactivated Personality', value: 'Aria' }),
              expect.objectContaining({ name: 'Channel', value: `<#${mockContext.channelId}>` }),
              expect.objectContaining({
                name: 'Note',
                value: 'The personality can still be mentioned directly or respond to replies.',
              }),
            ]),
          }),
        ],
      });
    });

    it('should reject in DM channels', async () => {
      // Arrange
      mockContext.guildId = null; // DM channel
      mockContext.getGuildId.mockReturnValue(null);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ The deactivate command can only be used in server channels, not DMs.'
      );
      expect(mockConversationManager.deactivatePersonality).not.toHaveBeenCalled();
    });

    it('should reject without Manage Messages permission', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(false);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Insufficient Permissions',
            description:
              'You need the "Manage Messages" permission to deactivate personalities in this channel.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.deactivatePersonality).not.toHaveBeenCalled();
    });

    it('should handle no active personality', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(true);
      mockConversationManager.getActivatedPersonality.mockReturnValue(null);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ No Active Personality',
            description: 'There is no active personality in this channel.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.deactivatePersonality).not.toHaveBeenCalled();
    });

    it('should handle deactivation errors', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(true);
      mockConversationManager.getActivatedPersonality.mockReturnValue('Aria');
      mockConversationManager.deactivatePersonality.mockImplementation(() => {
        throw new Error('Deactivation failed');
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Deactivation Failed',
            description: 'Failed to deactivate personality. Please try again.',
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[DeactivateCommand] Error deactivating personality:',
        expect.any(Error)
      );
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockContext.hasPermission.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ An unexpected error occurred. Please try again later.'
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DeactivateCommand] Unexpected error:',
        expect.any(Error)
      );
    });

    it('should log successful deactivation', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(true);
      mockConversationManager.getActivatedPersonality.mockReturnValue('Aria');

      // Act
      await command.execute(mockContext);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        `[DeactivateCommand] Successfully deactivated Aria in channel ${mockContext.channelId}`
      );
    });

    it('should include timestamp in embed', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(true);
      mockConversationManager.getActivatedPersonality.mockReturnValue('Aria');

      // Act
      await command.execute(mockContext);

      // Assert
      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].timestamp).toBeDefined();
      expect(embedCall.embeds[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should handle personalities with special characters in names', async () => {
      // Arrange
      mockContext.hasPermission.mockResolvedValue(true);
      mockConversationManager.getActivatedPersonality.mockReturnValue('Bambi Prime™');

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            description: expect.stringContaining('**Bambi Prime™** has been deactivated'),
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Deactivated Personality', value: 'Bambi Prime™' }),
            ]),
          }),
        ],
      });
    });
  });
});
