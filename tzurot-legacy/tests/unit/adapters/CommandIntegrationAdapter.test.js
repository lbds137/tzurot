/**
 * Tests for CommandIntegrationAdapter
 */

const { CommandIntegrationAdapter } = require('../../../src/adapters/CommandIntegrationAdapter');
const { createMigrationHelper } = require('../../utils/testEnhancements');

describe('CommandIntegrationAdapter', () => {
  let adapter;
  let mockCommandIntegration;
  let mockMessage;
  let migrationHelper;

  beforeEach(() => {
    jest.clearAllMocks();
    migrationHelper = createMigrationHelper();

    // Mock command integration
    mockCommandIntegration = {
      initialize: jest.fn().mockResolvedValue(),
      hasCommand: jest.fn().mockReturnValue(false),
      handleDiscordTextCommand: jest.fn().mockResolvedValue({ success: true }),
      getAllCommands: jest.fn().mockReturnValue([]),
      registerDiscordSlashCommands: jest.fn().mockResolvedValue(),
    };

    // Create adapter with mocks
    adapter = new CommandIntegrationAdapter({
      commandIntegration: mockCommandIntegration,
    });

    // Mock Discord message
    mockMessage = migrationHelper.bridge.createCompatibleMockMessage({
      content: '!tz test',
      userId: '123456789',
      channelId: '987654321',
    });
  });

  describe('initialization', () => {
    it('should initialize command integration on first use', async () => {
      expect(adapter.initialized).toBe(false);

      await adapter.initialize({ someService: 'test' });

      expect(mockCommandIntegration.initialize).toHaveBeenCalledWith({ someService: 'test' });
      expect(adapter.initialized).toBe(true);
    });

    it('should not initialize twice', async () => {
      await adapter.initialize();
      await adapter.initialize();

      expect(mockCommandIntegration.initialize).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization errors', async () => {
      mockCommandIntegration.initialize.mockRejectedValue(new Error('Init failed'));

      await expect(adapter.initialize()).rejects.toThrow('Init failed');
      expect(adapter.initialized).toBe(false);
    });
  });

  describe('processCommand', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should process commands through DDD system', async () => {
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      mockCommandIntegration.handleDiscordTextCommand.mockResolvedValue({
        success: true,
        response: 'Command executed',
      });

      const result = await adapter.processCommand(mockMessage, 'test', ['arg1']);

      expect(mockCommandIntegration.hasCommand).toHaveBeenCalledWith('test');
      expect(mockCommandIntegration.handleDiscordTextCommand).toHaveBeenCalledWith(
        mockMessage,
        'test',
        ['arg1']
      );
      expect(result).toEqual({ success: true, result: { success: true, response: 'Command executed' } });
    });

    it('should handle unknown commands', async () => {
      mockCommandIntegration.hasCommand.mockReturnValue(false);

      const result = await adapter.processCommand(mockMessage, 'unknown', []);

      expect(result).toEqual({
        success: false,
        error: 'Unknown command: unknown',
      });
      expect(mockCommandIntegration.handleDiscordTextCommand).not.toHaveBeenCalled();
    });

    it('should handle command errors gracefully', async () => {
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      mockCommandIntegration.handleDiscordTextCommand.mockRejectedValue(
        new Error('Command failed')
      );

      const result = await adapter.processCommand(mockMessage, 'test', []);

      expect(result).toEqual({
        success: false,
        error: 'Command failed',
      });
    });

    it('should initialize before processing if not initialized', async () => {
      adapter.initialized = false;

      mockCommandIntegration.hasCommand.mockReturnValue(true);
      await adapter.processCommand(mockMessage, 'test', []);

      expect(mockCommandIntegration.initialize).toHaveBeenCalled();
    });
  });

  describe('getCommandList', () => {
    it('should return empty list when not initialized', () => {
      const commands = adapter.getCommandList();
      expect(commands).toEqual([]);
    });

    it('should return formatted command list', async () => {
      await adapter.initialize();

      mockCommandIntegration.getAllCommands.mockReturnValue([
        { name: 'test', description: 'Test command', aliases: ['t'] },
        { name: 'help', description: 'Help command', aliases: [] },
      ]);

      const commands = adapter.getCommandList();

      expect(commands).toEqual([
        { name: 'test', description: 'Test command', aliases: ['t'] },
        { name: 'help', description: 'Help command', aliases: [] },
      ]);
    });
  });

  describe('registerSlashCommands', () => {
    it('should register slash commands', async () => {
      const mockClient = {};
      const guildId = '123456789';

      await adapter.registerSlashCommands(mockClient, guildId);

      expect(mockCommandIntegration.initialize).toHaveBeenCalled();
      expect(mockCommandIntegration.registerDiscordSlashCommands).toHaveBeenCalledWith(
        mockClient,
        guildId
      );
    });
  });

  describe('isReady', () => {
    it('should return initialization status', async () => {
      expect(adapter.isReady()).toBe(false);

      await adapter.initialize();

      expect(adapter.isReady()).toBe(true);
    });
  });
});