/**
 * @jest-environment node
 * @testType unit
 *
 * ActivateCommand Test
 * Tests the activate command functionality for DDD architecture
 */

const {
  createActivateCommand,
} = require('../../../../../src/application/commands/conversation/ActivateCommand');
const { Command } = require('../../../../../src/application/commands/CommandAbstraction');
const logger = require('../../../../../src/logger');

// Mock dependencies
jest.mock('../../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('ActivateCommand', () => {
  let command;
  let mockContext;
  let mockPersonalityService;
  let mockConversationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock services
    mockPersonalityService = {
      getPersonality: jest.fn(),
    };

    mockConversationManager = {
      activatePersonality: jest.fn().mockResolvedValue(true),
      getActivatedPersonality: jest.fn(),
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
        personalityApplicationService: mockPersonalityService,
        conversationManager: mockConversationManager,
        botPrefix: '!tz',
      },
      respond: jest.fn(),
      hasPermission: jest.fn(),
      isChannelNSFW: jest.fn(),
      getChannelId: jest.fn().mockReturnValue('987654321098765432'),
      getGuildId: jest.fn().mockReturnValue('111222333444555666'),
      getUserId: jest.fn().mockReturnValue('123456789012345678'),
      isDM: false,
    };

    // Create the command
    command = createActivateCommand();
  });

  describe('command metadata', () => {
    it('should have correct metadata', () => {
      expect(command.name).toBe('activate');
      expect(command.description).toBe(
        'Activate a personality to respond to all messages in this channel'
      );
      expect(command.category).toBe('Conversation');
      expect(command.aliases).toEqual(['act']);
      expect(command.options).toHaveLength(1);
      expect(command.options[0].name).toBe('personality');
      expect(command.options[0].required).toBe(true);
    });
  });

  describe('execute', () => {
    it('should activate a personality by name', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'Aria',
          displayName: 'Aria',
          avatarUrl: 'https://example.com/aria.png',
        },
        name: 'Aria',
        fullName: 'Aria',
        displayName: 'Aria',
        avatarUrl: 'https://example.com/aria.png',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('Aria');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Aria',
        mockContext.userId
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Activated',
            description: expect.stringContaining('**Aria** is now active'),
            color: 0x00ff00,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Personality', value: 'Aria' }),
              expect.objectContaining({ name: 'Channel', value: `<#${mockContext.channelId}>` }),
            ]),
          }),
        ],
      });
    });

    it('should activate a personality by alias', async () => {
      // Arrange
      mockContext.args = ['ari'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      // The getPersonality method now handles both name and alias lookup internally
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'Aria',
          displayName: 'Aria',
          avatarUrl: 'https://example.com/aria.png',
        },
        name: 'Aria',
        fullName: 'Aria',
        displayName: 'Aria',
        avatarUrl: 'https://example.com/aria.png',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('ari');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Aria',
        mockContext.userId
      );
    });

    it('should handle multi-word personality names', async () => {
      // Arrange
      mockContext.args = ['bambi', 'prime'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'Bambi Prime',
          displayName: 'Bambi Prime',
        },
        name: 'Bambi Prime',
        fullName: 'Bambi Prime',
        displayName: 'Bambi Prime',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('bambi prime');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Bambi Prime',
        mockContext.userId
      );
    });

    it('should use options.personality if provided', async () => {
      // Arrange
      mockContext.options.personality = 'Aria';
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        name: 'Aria',
        fullName: 'Aria',
        displayName: 'Aria',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('Aria');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Aria',
        mockContext.userId
      );
    });

    it('should reject in DM channels', async () => {
      // Arrange
      mockContext.guildId = null; // DM channel
      mockContext.getGuildId.mockReturnValue(null);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Server Channels Only',
            description: 'The activate command can only be used in server channels, not DMs.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should reject without Manage Messages permission', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(false);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Insufficient Permissions',
            description:
              'You need the "Manage Messages" permission to activate personalities in this channel.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should reject in non-NSFW channels', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(false);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ NSFW Channel Required',
            description:
              'For safety and compliance reasons, personalities can only be activated in channels marked as NSFW.',
            color: 0xff9800,
          }),
        ],
      });
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should handle missing personality name', async () => {
      // Arrange
      mockContext.args = [];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Missing Personality',
            description: 'Please specify a personality to activate.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should handle non-existent personality', async () => {
      // Arrange
      mockContext.args = ['NonExistent'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      // getPersonality now handles both name and alias lookup internally
      mockPersonalityService.getPersonality.mockResolvedValue(null);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Personality Not Found',
            description: 'Personality "NonExistent" not found.',
            color: 0xf44336,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Need help?',
                value: expect.stringContaining('!tz list'),
              }),
            ]),
          }),
        ],
      });
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should handle personality service errors', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockRejectedValue(new Error('Service error'));

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Lookup Error',
            description: 'Error looking up personality. Please try again.',
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[ActivateCommand] Error looking up personality:',
        expect.any(Error)
      );
    });

    it('should handle activation errors', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        name: 'Aria',
        fullName: 'Aria',
        displayName: 'Aria',
      });
      mockConversationManager.activatePersonality.mockRejectedValue(new Error('Activation failed'));

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ Failed to activate personality. Please try again.'
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[ActivateCommand] Error activating personality:',
        expect.any(Error)
      );
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockContext.args = ['Aria'];
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
        '[ActivateCommand] Unexpected error:',
        expect.any(Error)
      );
    });

    it('should not include thumbnail if profileUrl is missing', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'Aria',
          displayName: 'Aria',
          // No avatarUrl
        },
        name: 'Aria',
        fullName: 'Aria',
        displayName: 'Aria',
        // No avatarUrl
      });

      // Act
      await command.execute(mockContext);

      // Assert
      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].thumbnail).toBeUndefined();
    });

    it('should include thumbnail if profileUrl exists', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'Aria',
          displayName: 'Aria',
          avatarUrl: 'https://example.com/aria.png',
        },
        name: 'Aria',
        fullName: 'Aria',
        displayName: 'Aria',
        avatarUrl: 'https://example.com/aria.png',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].thumbnail).toEqual({
        url: 'https://example.com/aria.png',
      });
    });
  });
});
