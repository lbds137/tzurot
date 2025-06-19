/**
 * @jest-environment node
 * @testType unit
 *
 * AutorespondCommand Test
 * Tests the autorespond command functionality for DDD architecture
 */

const {
  createAutorespondCommand,
} = require('../../../../../src/application/commands/conversation/AutorespondCommand');
const { Command } = require('../../../../../src/application/commands/CommandAbstraction');
const logger = require('../../../../../src/logger');

// Mock dependencies
jest.mock('../../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('AutorespondCommand', () => {
  let command;
  let mockContext;
  let mockConversationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock services
    mockConversationManager = {
      isAutoResponseEnabled: jest.fn(),
      enableAutoResponse: jest.fn(),
      disableAutoResponse: jest.fn(),
    };

    // Create mock context
    mockContext = {
      args: [],
      options: {},
      userId: '123456789012345678',
      channelId: '987654321098765432',
      guildId: '111222333444555666',
      commandPrefix: '!tz',
      getUserId: jest.fn().mockReturnValue('123456789012345678'),
      dependencies: {
        conversationManager: mockConversationManager,
      },
      respond: jest.fn(),
    };

    // Create the command
    command = createAutorespondCommand();
  });

  describe('command metadata', () => {
    it('should have correct metadata', () => {
      expect(command.name).toBe('autorespond');
      expect(command.description).toBe('Manage your auto-response preference for conversations');
      expect(command.category).toBe('Conversation');
      expect(command.aliases).toEqual(['ar', 'auto']);
      expect(command.options).toHaveLength(1);
      expect(command.options[0].name).toBe('action');
      expect(command.options[0].required).toBe(false);
      expect(command.options[0].choices).toHaveLength(3);
    });
  });

  describe('status display', () => {
    it('should show status when no action provided', async () => {
      // Arrange
      mockConversationManager.isAutoResponseEnabled.mockReturnValue(true);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockConversationManager.isAutoResponseEnabled).toHaveBeenCalledWith(
        mockContext.userId
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔄 Auto-Response Status',
            description: expect.stringContaining('currently **enabled**'),
            color: 0x00ff00,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Current Setting', value: '✅ Enabled' }),
              expect.objectContaining({ name: 'User', value: `<@${mockContext.userId}>` }),
            ]),
          }),
        ],
      });
    });

    it('should show disabled status correctly', async () => {
      // Arrange
      mockConversationManager.isAutoResponseEnabled.mockReturnValue(false);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            description: expect.stringContaining('currently **disabled**'),
            color: 0xff0000,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Current Setting', value: '❌ Disabled' }),
            ]),
          }),
        ],
      });
    });

    it('should show status when explicitly requested', async () => {
      // Arrange
      mockContext.args = ['status'];
      mockConversationManager.isAutoResponseEnabled.mockReturnValue(true);

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔄 Auto-Response Status',
          }),
        ],
      });
    });

    it('should use options.action over args', async () => {
      // Arrange
      mockContext.args = ['off'];
      mockContext.options.action = 'status';
      mockConversationManager.isAutoResponseEnabled.mockReturnValue(true);

      // Act
      await command.execute(mockContext);

      // Assert
      // Should show status, not turn off
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔄 Auto-Response Status',
          }),
        ],
      });
    });
  });

  describe('enable action', () => {
    it('should enable auto-response', async () => {
      // Arrange
      mockContext.args = ['on'];

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockConversationManager.enableAutoResponse).toHaveBeenCalledWith(mockContext.userId);
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Auto-Response Enabled',
            description: expect.stringContaining('will now continue responding'),
            color: 0x00ff00,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'What changed?',
                value: expect.stringContaining('no longer need to mention'),
              }),
              expect.objectContaining({
                name: 'How to stop a conversation',
                value: expect.stringContaining('reset command'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle enable errors', async () => {
      // Arrange
      mockContext.args = ['on'];
      mockConversationManager.enableAutoResponse.mockImplementation(() => {
        throw new Error('Failed to save preference');
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Error',
            description: 'Failed to enable auto-response. Please try again.',
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[AutorespondCommand] Error enabling auto-response:',
        expect.any(Error)
      );
    });

    it('should log successful enable', async () => {
      // Arrange
      mockContext.args = ['on'];

      // Act
      await command.execute(mockContext);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        `[AutorespondCommand] Enabled auto-response for user ${mockContext.userId}`
      );
    });
  });

  describe('disable action', () => {
    it('should disable auto-response', async () => {
      // Arrange
      mockContext.args = ['off'];

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockConversationManager.disableAutoResponse).toHaveBeenCalledWith(mockContext.userId);
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Auto-Response Disabled',
            description: expect.stringContaining('will no longer automatically respond'),
            color: 0xff0000,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'What changed?',
                value: expect.stringContaining('need to mention'),
              }),
              expect.objectContaining({
                name: 'Why disable?',
                value: expect.stringContaining('more control'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle disable errors', async () => {
      // Arrange
      mockContext.args = ['off'];
      mockConversationManager.disableAutoResponse.mockImplementation(() => {
        throw new Error('Failed to save preference');
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Error',
            description: 'Failed to disable auto-response. Please try again.',
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[AutorespondCommand] Error disabling auto-response:',
        expect.any(Error)
      );
    });

    it('should log successful disable', async () => {
      // Arrange
      mockContext.args = ['off'];

      // Act
      await command.execute(mockContext);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        `[AutorespondCommand] Disabled auto-response for user ${mockContext.userId}`
      );
    });
  });

  describe('invalid actions', () => {
    it('should reject invalid action', async () => {
      // Arrange
      mockContext.args = ['invalid'];

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Invalid Action',
            description: 'Invalid action "invalid". Use `on`, `off`, or `status`.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.enableAutoResponse).not.toHaveBeenCalled();
      expect(mockConversationManager.disableAutoResponse).not.toHaveBeenCalled();
    });

    it('should handle case insensitive actions', async () => {
      // Arrange
      mockContext.args = ['ON'];

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockConversationManager.enableAutoResponse).toHaveBeenCalledWith(mockContext.userId);
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockContext.args = ['status'];
      mockConversationManager.isAutoResponseEnabled.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      // Act
      await command.execute(mockContext);

      // Assert
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Error',
            description: 'An unexpected error occurred. Please try again later.',
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[AutorespondCommand] Unexpected error:',
        expect.any(Error)
      );
    });
  });

  describe('embed formatting', () => {
    it('should include timestamps in all embeds', async () => {
      // Arrange
      const testCases = ['on', 'off', 'status'];

      for (const action of testCases) {
        jest.clearAllMocks();
        mockContext.args = [action];
        mockConversationManager.isAutoResponseEnabled.mockReturnValue(true);

        // Act
        await command.execute(mockContext);

        // Assert
        const embedCall = mockContext.respond.mock.calls[0][0];
        expect(embedCall.embeds[0].timestamp).toBeDefined();
        expect(embedCall.embeds[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });

    it('should include footer with help text in status embed', async () => {
      // Arrange
      mockConversationManager.isAutoResponseEnabled.mockReturnValue(true);

      // Act
      await command.execute(mockContext);

      // Assert
      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].footer).toEqual({
        text: expect.stringContaining('!tz autorespond on/off'),
      });
    });
  });
});
