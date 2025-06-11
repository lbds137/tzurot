/**
 * Tests for CommandIntegrationAdapter
 */

// Mock before imports
jest.mock('../../../src/commandLoader', () => ({
  processCommand: jest.fn()
}));

const { CommandIntegrationAdapter } = require('../../../src/adapters/CommandIntegrationAdapter');
const { createMigrationHelper } = require('../../utils/testEnhancements');
const { processCommand: mockProcessCommand } = require('../../../src/commandLoader');

describe('CommandIntegrationAdapter', () => {
  let adapter;
  let mockFeatureFlags;
  let mockCommandIntegration;
  let mockMessage;
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();
    
    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false),
      hasFlag: jest.fn().mockReturnValue(false)
    };

    // Mock command integration
    mockCommandIntegration = {
      initialize: jest.fn().mockResolvedValue(),
      hasCommand: jest.fn().mockReturnValue(false),
      handleDiscordTextCommand: jest.fn().mockResolvedValue({ success: true }),
      getAllCommands: jest.fn().mockReturnValue([]),
      registerDiscordSlashCommands: jest.fn().mockResolvedValue()
    };

    // Create adapter with mocks
    adapter = new CommandIntegrationAdapter({
      featureFlags: mockFeatureFlags,
      commandIntegration: mockCommandIntegration
    });

    // Mock Discord message
    mockMessage = migrationHelper.bridge.createCompatibleMockMessage({
      content: '!tz test',
      userId: '123456789',
      channelId: '987654321'
    });

    // Configure the mock for each test
    mockProcessCommand.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize command integration on first use', async () => {
      await adapter.processCommand(mockMessage, 'test', []);
      
      expect(mockCommandIntegration.initialize).toHaveBeenCalledTimes(1);
      expect(adapter.initialized).toBe(true);
    });

    it('should not initialize twice', async () => {
      await adapter.initialize();
      await adapter.initialize();
      
      expect(mockCommandIntegration.initialize).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent initialization', async () => {
      // Start multiple initializations concurrently
      const promises = [
        adapter.initialize(),
        adapter.initialize(),
        adapter.initialize()
      ];
      
      await Promise.all(promises);
      
      expect(mockCommandIntegration.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('command routing', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should route to legacy system when feature flag is disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      
      const result = await adapter.processCommand(mockMessage, 'add', ['test']);
      
      expect(result.success).toBe(true);
      expect(mockCommandIntegration.handleDiscordTextCommand).not.toHaveBeenCalled();
    });

    it('should route to new system when feature flag is enabled', async () => {
      // Ensure adapter is initialized first
      await adapter.initialize();
      
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        return flag === 'ddd.commands.enabled' || flag === 'ddd.commands.add';
      });
      mockFeatureFlags.hasFlag.mockImplementation(flag => {
        return flag === 'ddd.commands.add';
      });
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      
      const result = await adapter.processCommand(mockMessage, 'add', ['test']);
      
      expect(result.success).toBe(true);
      expect(mockCommandIntegration.handleDiscordTextCommand).toHaveBeenCalledWith(
        mockMessage,
        'add',
        ['test']
      );
      // Verify it didn't call legacy
      expect(mockProcessCommand).not.toHaveBeenCalled();
    });

    it('should check personality category flag', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        return flag === 'ddd.commands.enabled' || flag === 'ddd.commands.personality';
      });
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      
      const personalityCommands = ['add', 'remove', 'info', 'reset', 'alias', 'list'];
      
      for (const cmd of personalityCommands) {
        await adapter.processCommand(mockMessage, cmd, []);
        expect(mockCommandIntegration.handleDiscordTextCommand).toHaveBeenCalledWith(
          mockMessage,
          cmd,
          []
        );
      }
    });

    it('should use legacy for commands not in new system', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(true);
      mockCommandIntegration.hasCommand.mockReturnValue(false);
      
      const result = await adapter.processCommand(mockMessage, 'unknown', []);
      
      expect(result.success).toBe(true);
      expect(mockCommandIntegration.handleDiscordTextCommand).not.toHaveBeenCalled();
    });

    it('should handle command-specific feature flags', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        return flag === 'ddd.commands.enabled';
      });
      mockFeatureFlags.hasFlag.mockImplementation(flag => {
        return flag === 'ddd.commands.test';
      });
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      
      await adapter.processCommand(mockMessage, 'test', []);
      
      expect(mockFeatureFlags.hasFlag).toHaveBeenCalledWith('ddd.commands.test');
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return error response on exception', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        // Enable new system but not fallback
        return flag === 'ddd.commands.enabled' || flag === 'ddd.commands.add';
      });
      mockFeatureFlags.hasFlag.mockImplementation(flag => {
        return flag === 'ddd.commands.add';
      });
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      mockCommandIntegration.handleDiscordTextCommand.mockRejectedValue(
        new Error('Test error')
      );
      
      const result = await adapter.processCommand(mockMessage, 'add', []);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
    });

    it('should fall back to legacy on error if flag enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        return flag === 'ddd.commands.enabled' || 
               flag === 'ddd.commands.add' ||
               flag === 'ddd.commands.fallbackOnError';
      });
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      mockCommandIntegration.handleDiscordTextCommand.mockRejectedValue(
        new Error('Test error')
      );
      
      const result = await adapter.processCommand(mockMessage, 'add', []);
      
      expect(result.success).toBe(true);
    });
  });

  describe('slash command registration', () => {
    const mockClient = { user: { id: '123' } };

    it('should skip registration if feature flag disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      
      await adapter.registerSlashCommands(mockClient);
      
      expect(mockCommandIntegration.registerDiscordSlashCommands).not.toHaveBeenCalled();
    });

    it('should register slash commands if enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        return flag === 'ddd.commands.slash';
      });
      
      await adapter.registerSlashCommands(mockClient, '12345');
      
      expect(mockCommandIntegration.registerDiscordSlashCommands).toHaveBeenCalledWith(
        mockClient,
        '12345'
      );
    });
  });

  describe('command list', () => {
    it('should return new commands marked as new', () => {
      adapter.initialized = true;
      mockCommandIntegration.getAllCommands.mockReturnValue([
        { name: 'add', description: 'Add personality', aliases: ['create'] }
      ]);
      mockFeatureFlags.isEnabled.mockReturnValue(true);
      mockCommandIntegration.hasCommand.mockReturnValue(true);
      
      const commands = adapter.getCommandList();
      
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({
        name: 'add',
        description: 'Add personality',
        aliases: ['create'],
        isNew: true
      });
    });
  });
});