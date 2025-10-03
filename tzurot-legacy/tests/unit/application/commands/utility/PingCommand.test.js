/**
 * Tests for PingCommand
 */

const {
  createPingCommand,
} = require('../../../../../src/application/commands/utility/PingCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

describe('PingCommand', () => {
  let pingCommand;
  let mockContext;
  let migrationHelper;
  let originalClient;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Save original client and set up mock
    originalClient = global.tzurotClient;
    global.tzurotClient = {
      ws: {
        ping: 42
      }
    };

    migrationHelper = createMigrationHelper();

    // Create command with mock config
    pingCommand = createPingCommand({
      botConfig: { name: 'TestBot' },
    });

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: jest.fn().mockReturnValue(false),
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
    };
  });
  
  afterEach(() => {
    // Restore original client
    global.tzurotClient = originalClient;
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
        embeds: [
          expect.objectContaining({
            title: '🏓 Pong!',
            description: 'TestBot is operational.',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Status', value: '✅ Online' }),
              expect.objectContaining({
                name: 'Latency',
                value: '42ms',
              }),
            ]),
          }),
        ],
      });
      expect(mockContext.respond).toHaveBeenCalledTimes(1);
    });

    it('should work in DM channels', async () => {
      mockContext.isDM.mockReturnValue(true);

      await pingCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🏓 Pong!',
            description: 'TestBot is operational.',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Status', value: '✅ Online' }),
              expect.objectContaining({
                name: 'Latency',
                value: '42ms',
              }),
            ]),
          }),
        ],
      });
    });

    it('should work in guild channels', async () => {
      mockContext.isDM.mockReturnValue(false);

      await pingCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🏓 Pong!',
            description: 'TestBot is operational.',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Status', value: '✅ Online' }),
              expect.objectContaining({
                name: 'Latency',
                value: '42ms',
              }),
            ]),
          }),
        ],
      });
    });
    
    it('should handle missing websocket ping', async () => {
      // Test with no client
      global.tzurotClient = null;
      
      await pingCommand.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Latency',
                value: 'Calculating...',
              }),
            ]),
          }),
        ],
      });
    });
    
    it('should handle missing ws property', async () => {
      // Test with client but no ws
      global.tzurotClient = {};
      
      await pingCommand.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Latency',
                value: 'Calculating...',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle missing bot config gracefully', async () => {
      // Create command without injected config
      const commandWithoutConfig = createPingCommand();

      // Should fall back to require statement
      await commandWithoutConfig.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: expect.stringContaining('Pong!'),
            description: expect.stringContaining('operational'),
          }),
        ],
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
        embeds: [
          expect.objectContaining({
            title: '❌ Ping Failed',
            description: 'An error occurred while checking bot status.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });
});