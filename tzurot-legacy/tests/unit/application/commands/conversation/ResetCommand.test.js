/**
 * Tests for ResetCommand
 */

const {
  createResetCommand,
} = require('../../../../../src/application/commands/conversation/ResetCommand');

describe('ResetCommand', () => {
  let command;
  let mockContext;
  let mockPersonalityService;
  let mockConversationManager;
  let mockFeatureFlags;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create command instance
    command = createResetCommand();

    // Mock personality service
    mockPersonalityService = {
      getPersonality: jest.fn().mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: 'Test Personality',
        },
      }),
    };

    // Mock conversation manager
    mockConversationManager = {
      clearConversation: jest.fn().mockReturnValue(true),
    };

    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(true),
    };

    // Mock context
    mockContext = {
      isSlashCommand: false,
      args: ['testpersonality'],
      options: {},
      getUserId: jest.fn().mockReturnValue('123456789'),
      getChannelId: jest.fn().mockReturnValue('987654321'),
      respond: jest.fn().mockResolvedValue(),
      dependencies: {
        personalityApplicationService: mockPersonalityService,
        conversationManager: mockConversationManager,
        featureFlags: mockFeatureFlags,
        botPrefix: '!tz',
      },
    };
  });

  describe('command metadata', () => {
    it('should have correct properties', () => {
      expect(command.name).toBe('reset');
      expect(command.description).toBe('Reset your conversation with a personality');
      expect(command.category).toBe('conversation');
      expect(command.permissions).toEqual(['USER']);
    });

    it('should have correct options', () => {
      expect(command.options).toHaveLength(1);
      expect(command.options[0].name).toBe('personality');
      expect(command.options[0].required).toBe(true);
      expect(command.options[0].type).toBe('string');
    });
  });

  describe('execute', () => {
    it('should reset conversation successfully', async () => {
      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('testpersonality');
      expect(mockConversationManager.clearConversation).toHaveBeenCalledWith(
        '123456789',
        '987654321',
        'testpersonality'
      );

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Conversation Reset',
            description: expect.stringContaining(
              'Your conversation with **Test Personality** has been reset'
            ),
            color: 0x4caf50,
          }),
        ],
      });
    });


    it('should handle missing personality name', async () => {
      mockContext.args = [];

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Missing Personality Name',
            description: expect.stringContaining('Please provide a personality name'),
            color: 0xf44336,
          }),
        ],
      });
      expect(mockPersonalityService.getPersonality).not.toHaveBeenCalled();
    });

    it('should handle slash command format', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { personality: 'SlashPersonality' };

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('SlashPersonality');
    });

    it('should handle personality not found', async () => {
      mockPersonalityService.getPersonality.mockResolvedValue(null);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Personality Not Found',
            description: expect.stringContaining(
              'Could not find a personality named **testpersonality**'
            ),
            color: 0xf44336,
          }),
        ],
      });
      expect(mockConversationManager.clearConversation).not.toHaveBeenCalled();
    });

    it('should handle no active conversation', async () => {
      mockConversationManager.clearConversation.mockReturnValue(false);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ No Active Conversation',
            description: expect.stringContaining(
              'No active conversation found with **Test Personality**'
            ),
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Error Resetting Conversation',
            description: expect.stringContaining(
              'An error occurred while trying to reset the conversation'
            ),
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle missing conversation manager', async () => {
      mockContext.dependencies.conversationManager = null;

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Error Resetting Conversation',
            description: expect.stringContaining(
              'An error occurred while trying to reset the conversation'
            ),
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle errors gracefully', async () => {
      mockPersonalityService.getPersonality.mockRejectedValue(new Error('Database error'));

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Error Resetting Conversation',
            description: expect.stringContaining(
              'An error occurred while trying to reset the conversation'
            ),
            color: 0xf44336,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Error details',
                value: 'Database error',
              }),
            ]),
          }),
        ],
      });
    });
  });
});
