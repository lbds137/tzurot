/**
 * Tests for PurgbotCommand
 */

const {
  createPurgbotCommand,
  isPersonalityMessage,
  filterMessagesByCategory,
} = require('../../../../../src/application/commands/utility/PurgbotCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

// Mock timer functions
jest.useFakeTimers();

describe('PurgbotCommand', () => {
  let purgbotCommand;
  let mockContext;
  let mockChannel;
  let mockMessages;
  let mockStatusMessage;
  let migrationHelper;
  let mockDependencies;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();

    // Mock status message
    mockStatusMessage = {
      id: 'status123',
      edit: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    // Mock messages
    mockMessages = new Map([
      [
        'msg1',
        {
          id: 'msg1',
          content: 'System message',
          author: { id: 'bot123', username: 'TestBot' },
          delete: jest.fn().mockResolvedValue(undefined),
        },
      ],
      [
        'msg2',
        {
          id: 'msg2',
          content: '**Personality:** Hello!',
          author: { id: 'bot123', username: 'TestBot' },
          delete: jest.fn().mockResolvedValue(undefined),
        },
      ],
      [
        'msg3',
        {
          id: 'msg3',
          content: 'User message',
          author: { id: 'user123', username: 'TestUser' },
          delete: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    // Mock channel
    mockChannel = {
      isDMBased: jest.fn().mockReturnValue(true),
      sendTyping: jest.fn().mockResolvedValue(undefined),
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMessages),
      },
    };

    // Create mock dependencies
    mockDependencies = {
      delayFn: jest.fn().mockResolvedValue(undefined),
      scheduleFn: jest.fn((callback, ms) => {
        // Use fake timers for scheduling
        setTimeout(callback, ms);
      }),
    };

    // Create command with mock timer functions
    purgbotCommand = createPurgbotCommand(mockDependencies);

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'dm123',
      commandPrefix: '!tz',
      isDM: jest.fn().mockReturnValue(true),
      platform: 'discord',
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(mockStatusMessage),
      respondWithEmbed: jest.fn().mockResolvedValue(mockStatusMessage),
      message: {
        id: 'cmd123',
        channel: mockChannel,
        client: {
          user: { id: 'bot123' },
        },
      },
      channel: mockChannel,
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(purgbotCommand.name).toBe('purgbot');
      expect(purgbotCommand.description).toBe('Purge bot messages from your DM history');
      expect(purgbotCommand.category).toBe('Utility');
      expect(purgbotCommand.aliases).toEqual(['purgebot', 'clearbot', 'cleandm']);
      expect(purgbotCommand.permissions).toEqual(['USER']);
      expect(purgbotCommand.options).toHaveLength(1);
    });
  });

  describe('DM restriction', () => {
    it('should reject non-DM channels', async () => {
      mockContext.isDM.mockReturnValue(false);

      await purgbotCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        '⚠️ This command can only be used in DM channels for security reasons.'
      );
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });
  });

  describe('category validation', () => {
    it('should accept system category', async () => {
      mockContext.args = ['system'];

      await purgbotCommand.execute(mockContext);

      expect(mockChannel.messages.fetch).toHaveBeenCalled();
    });

    it('should accept all category', async () => {
      mockContext.args = ['all'];

      await purgbotCommand.execute(mockContext);

      expect(mockChannel.messages.fetch).toHaveBeenCalled();
    });

    it('should default to system category', async () => {
      await purgbotCommand.execute(mockContext);

      expect(mockChannel.messages.fetch).toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Purging system and command messages')
      );
    });

    it('should reject invalid category', async () => {
      mockContext.args = ['invalid'];

      await purgbotCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('❌ Invalid category: `invalid`')
      );
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('should work with options instead of args', async () => {
      mockContext.options.category = 'all';

      await purgbotCommand.execute(mockContext);

      expect(mockChannel.messages.fetch).toHaveBeenCalled();
    });
  });

  describe('isPersonalityMessage', () => {
    it('should identify personality messages', () => {
      const msg = { content: '**Alice:** Hello there!' };
      expect(isPersonalityMessage(msg)).toBe(true);
    });

    it('should identify non-personality messages', () => {
      const msg = { content: 'Regular system message' };
      expect(isPersonalityMessage(msg)).toBe(false);
    });

    it('should handle messages without content', () => {
      const msg = {};
      expect(isPersonalityMessage(msg)).toBe(false);
    });
  });

  describe('filterMessagesByCategory', () => {
    const messages = [
      { id: '1', content: 'System', author: { id: 'bot123' } },
      { id: '2', content: '**Name:** Hi', author: { id: 'bot123' } },
      { id: '3', content: 'User msg', author: { id: 'user123' } },
      { id: 'cmd', content: 'Command', author: { id: 'bot123' } },
    ];

    it('should filter system messages only', () => {
      const filtered = filterMessagesByCategory(messages, 'bot123', 'cmd', 'system');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('should filter all bot messages', () => {
      const filtered = filterMessagesByCategory(messages, 'bot123', 'cmd', 'all');
      expect(filtered).toHaveLength(2);
      expect(filtered.map(m => m.id)).toEqual(['1', '2']);
    });

    it('should exclude command message', () => {
      const filtered = filterMessagesByCategory(messages, 'bot123', 'cmd', 'all');
      expect(filtered.find(m => m.id === 'cmd')).toBeUndefined();
    });

    it('should exclude user messages', () => {
      const filtered = filterMessagesByCategory(messages, 'bot123', 'cmd', 'all');
      expect(filtered.find(m => m.author.id === 'user123')).toBeUndefined();
    });
  });

  describe('message purging', () => {
    it('should purge system messages successfully', async () => {
      await purgbotCommand.execute(mockContext);

      // Should delete only the system message
      expect(mockMessages.get('msg1').delete).toHaveBeenCalled();
      expect(mockMessages.get('msg2').delete).not.toHaveBeenCalled();
      expect(mockMessages.get('msg3').delete).not.toHaveBeenCalled();

      expect(mockStatusMessage.edit).toHaveBeenCalledWith({
        content: '',
        embeds: [
          expect.objectContaining({
            title: 'Bot Message Cleanup',
            fields: expect.arrayContaining([
              { name: 'Messages Deleted', value: '1', inline: true },
              { name: 'Messages Failed', value: '0', inline: true },
            ]),
          }),
        ],
      });
    });

    it('should purge all bot messages when requested', async () => {
      mockContext.args = ['all'];

      await purgbotCommand.execute(mockContext);

      // Should delete both bot messages
      expect(mockMessages.get('msg1').delete).toHaveBeenCalled();
      expect(mockMessages.get('msg2').delete).toHaveBeenCalled();
      expect(mockMessages.get('msg3').delete).not.toHaveBeenCalled();
    });

    it('should handle no messages to delete', async () => {
      // Only user messages
      mockMessages = new Map([
        [
          'msg1',
          {
            id: 'msg1',
            content: 'User message',
            author: { id: 'user123', username: 'TestUser' },
          },
        ],
      ]);
      mockChannel.messages.fetch.mockResolvedValue(mockMessages);

      await purgbotCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        'No system and command messages found to purge.'
      );
    });

    it('should handle delete failures gracefully', async () => {
      mockMessages.get('msg1').delete.mockRejectedValue(new Error('Delete failed'));

      await purgbotCommand.execute(mockContext);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete message msg1')
      );
      expect(mockStatusMessage.edit).toHaveBeenCalledWith({
        content: '',
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              { name: 'Messages Deleted', value: '0', inline: true },
              { name: 'Messages Failed', value: '1', inline: true },
            ]),
          }),
        ],
      });
    });

    it('should schedule self-destruct of status message', async () => {
      await purgbotCommand.execute(mockContext);

      // Check that scheduleFn was called
      expect(mockDependencies.scheduleFn).toHaveBeenCalledWith(expect.any(Function), 10000);

      // Fast-forward timers
      jest.runAllTimers();

      // Give async operations time to complete
      await Promise.resolve();

      expect(mockStatusMessage.delete).toHaveBeenCalled();
    });

    it('should handle self-destruct failures gracefully', async () => {
      mockStatusMessage.delete.mockRejectedValue(new Error('Already deleted'));

      await purgbotCommand.execute(mockContext);

      // Fast-forward timers
      jest.runAllTimers();

      // Give async operations time to complete
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to self-destruct'));
    });
  });

  describe('platform handling', () => {
    it('should show not implemented for non-Discord platforms', async () => {
      mockContext.platform = 'revolt';

      await purgbotCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        'This command is not yet implemented for this platform.'
      );
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle fetch errors gracefully', async () => {
      mockChannel.messages.fetch.mockRejectedValue(new Error('API Error'));

      await purgbotCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith('[PurgBot] Error during Discord purge: API Error');
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ An error occurred while purging messages: API Error'
      );
    });

    it('should handle missing channel gracefully', async () => {
      mockContext.message.channel = null;
      mockContext.channel = null;

      await purgbotCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith('Unable to access channel information.');
    });

    it('should handle unexpected errors', async () => {
      // Create context that will cause an error when checking isDM
      const errorContext = {
        ...mockContext,
        isDM: jest.fn().mockImplementation(() => {
          throw new Error('Unexpected error accessing isDM');
        }),
        respond: jest.fn(),
      };

      await purgbotCommand.execute(errorContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[PurgbotCommand] Execution failed:',
        expect.any(Error)
      );
      expect(errorContext.respond).toHaveBeenCalledWith(
        'An error occurred while purging messages.'
      );
    });
  });

  describe('text-only fallback', () => {
    it('should handle text-only response when embeds not supported', async () => {
      delete mockContext.respondWithEmbed;

      await purgbotCommand.execute(mockContext);

      expect(mockStatusMessage.edit).toHaveBeenCalledWith(
        expect.stringContaining('✅ Cleanup complete!')
      );
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createPurgbotCommand();

      expect(command).toBeDefined();
      expect(command.name).toBe('purgbot');
    });

    it('should create command with custom dependencies', () => {
      const command = createPurgbotCommand({ custom: true });

      expect(command).toBeDefined();
      expect(command.name).toBe('purgbot');
    });
  });
});
