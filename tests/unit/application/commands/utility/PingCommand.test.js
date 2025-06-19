/**
 * Tests for PingCommand
 */

const { createPingCommand } = require('../../../../../src/application/commands/utility/PingCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

describe('PingCommand', () => {
  let pingCommand;
  let mockContext;
  let migrationHelper;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();
    
    // Create command with mock config
    pingCommand = createPingCommand({
      botConfig: { name: 'TestBot' }
    });

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz ',
      isDM: false,
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(pingCommand.name).toBe('ping');
      expect(pingCommand.description).toBe('Check if the bot is online');
      expect(pingCommand.category).toBe('Utility');
      expect(pingCommand.aliases).toEqual([]);
      expect(pingCommand.options).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should respond with pong message', async () => {
      await pingCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          title: '🏓 Pong!',
          description: 'TestBot is operational.',
          color: 0x4caf50,
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'Status', value: '✅ Online' }),
            expect.objectContaining({ name: 'Response Time', value: expect.stringMatching(/\d+ms/) })
          ])
        })]
      });
      expect(mockContext.respond).toHaveBeenCalledTimes(1);
    });

    it('should work in DM channels', async () => {
      mockContext.isDM = true;

      await pingCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          title: '🏓 Pong!',
          description: 'TestBot is operational.',
          color: 0x4caf50,
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'Status', value: '✅ Online' }),
            expect.objectContaining({ name: 'Response Time', value: expect.stringMatching(/\d+ms/) })
          ])
        })]
      });
    });

    it('should work in guild channels', async () => {
      mockContext.isDM = false;

      await pingCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          title: '🏓 Pong!',
          description: 'TestBot is operational.',
          color: 0x4caf50,
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'Status', value: '✅ Online' }),
            expect.objectContaining({ name: 'Response Time', value: expect.stringMatching(/\d+ms/) })
          ])
        })]
      });
    });

    it('should handle missing bot config gracefully', async () => {
      // Create command without injected config
      const commandWithoutConfig = createPingCommand();
      
      // Should fall back to require statement
      await commandWithoutConfig.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          title: expect.stringContaining('Pong!'),
          description: expect.stringContaining('operational')
        })]
      });
    });

    it('should handle errors gracefully', async () => {
      mockContext.respond.mockRejectedValueOnce(new Error('Network error'));

      await pingCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[PingCommand] Execution failed:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledTimes(2);
      expect(mockContext.respond).toHaveBeenLastCalledWith({
        embeds: [expect.objectContaining({
          title: '❌ Ping Failed',
          description: 'An error occurred while checking bot status.',
          color: 0xf44336
        })]
      });
    });

    it('should handle unexpected errors', async () => {
      // Mock the executor to throw an error
      const brokenCommand = createPingCommand({
        botConfig: null // This will cause an error when accessing name
      });

      await brokenCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[PingCommand] Execution failed:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          title: '❌ Ping Failed',
          description: 'An error occurred while checking bot status.',
          color: 0xf44336
        })]
      });
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createPingCommand();
      
      expect(command).toBeDefined();
      expect(command.name).toBe('ping');
    });

    it('should create command with custom dependencies', () => {
      const customConfig = { name: 'CustomBot' };
      const command = createPingCommand({ botConfig: customConfig });
      
      expect(command).toBeDefined();
      expect(command.name).toBe('ping');
    });
  });
});