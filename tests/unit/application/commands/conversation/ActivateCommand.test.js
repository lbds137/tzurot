/**
 * @jest-environment node
 * @testType unit
 *
 * ActivateCommand Test
 * Tests the activate command functionality for DDD architecture
 */

const { createActivateCommand } = require('../../../../../src/application/commands/conversation/ActivateCommand');
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
      findPersonalityByAlias: jest.fn(),
    };

    mockConversationManager = {
      activatePersonality: jest.fn(),
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
      services: {
        personalityApplicationService: mockPersonalityService,
        conversationManager: mockConversationManager,
        botPrefix: '!tz',
      },
      respond: jest.fn(),
      hasPermission: jest.fn(),
      isChannelNSFW: jest.fn(),
    };

    // Create the command
    command = createActivateCommand();
  });

  describe('command metadata', () => {
    it('should have correct metadata', () => {
      expect(command.name).toBe('activate');
      expect(command.description).toBe('Activate a personality to respond to all messages in this channel');
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
        name: 'Aria',
        profileUrl: 'https://example.com/aria.png',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('Aria');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Aria'
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
      mockPersonalityService.getPersonality.mockResolvedValue(null);
      mockPersonalityService.findPersonalityByAlias.mockResolvedValue({
        name: 'Aria',
        profileUrl: 'https://example.com/aria.png',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('ari');
      expect(mockPersonalityService.findPersonalityByAlias).toHaveBeenCalledWith('ari');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Aria'
      );
    });

    it('should handle multi-word personality names', async () => {
      // Arrange
      mockContext.args = ['bambi', 'prime'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        name: 'Bambi Prime',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('bambi prime');
      expect(mockConversationManager.activatePersonality).toHaveBeenCalledWith(
        mockContext.channelId,
        'Bambi Prime'
      );
    });

    it('should use options.personality if provided', async () => {
      // Arrange
      mockContext.options.personality = 'Aria';
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue({
        name: 'Aria',
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('Aria');
    });

    it('should reject in DM channels', async () => {
      // Arrange
      mockContext.guildId = null; // DM channel

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ The activate command can only be used in server channels, not DMs.'
      );
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should reject without Manage Messages permission', async () => {
      // Arrange
      mockContext.args = ['Aria'];
      mockContext.hasPermission.mockResolvedValue(false);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ You need the "Manage Messages" permission to activate personalities in this channel.'
      );
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
      expect(mockContext.respond).toHaveBeenCalledWith(
        '⚠️ For safety and compliance reasons, personalities can only be activated in channels marked as NSFW.'
      );
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
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ Please specify a personality to activate.'
      );
      expect(mockConversationManager.activatePersonality).not.toHaveBeenCalled();
    });

    it('should handle non-existent personality', async () => {
      // Arrange
      mockContext.args = ['NonExistent'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockPersonalityService.getPersonality.mockResolvedValue(null);
      mockPersonalityService.findPersonalityByAlias.mockResolvedValue(null);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ Personality "NonExistent" not found. Use `!tz list` to see available personalities.'
      );
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
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ Error looking up personality. Please try again.'
      );
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
      mockPersonalityService.getPersonality.mockResolvedValue({ name: 'Aria' });
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
        name: 'Aria',
        // No profileUrl
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
        name: 'Aria',
        profileUrl: 'https://example.com/aria.png',
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