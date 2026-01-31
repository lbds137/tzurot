/**
 * @jest-environment node
 * @testType unit
 *
 * CommandIntegration Test
 * Tests the command integration module
 */

const {
  CommandIntegration,
  getCommandIntegration,
  resetCommandIntegration,
} = require('../../../../src/application/commands/CommandIntegration');
const { getCommandRegistry } = require('../../../../src/application/commands/CommandAbstraction');
const { createAddCommand } = require('../../../../src/application/commands/personality/AddCommand');

// Mock dependencies
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../../../../src/application/services/FeatureFlags', () => ({
  createFeatureFlags: jest.fn().mockReturnValue({
    isEnabled: jest.fn().mockReturnValue(false),
  }),
}));

jest.mock('../../../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn().mockReturnValue({
    getPersonalityApplicationService: jest.fn().mockReturnValue({
      registerPersonality: jest.fn(),
      getPersonality: jest.fn(),
      removePersonality: jest.fn(),
    }),
  }),
}));

jest.mock('../../../../src/application/commands/personality/AddCommand', () => {
  const { Command } = require('../../../../src/application/commands/CommandAbstraction');
  return {
    createAddCommand: jest.fn().mockImplementation(
      () =>
        new Command({
          name: 'add',
          description: 'Add personality',
          category: 'personality',
          aliases: ['create'],
          execute: jest.fn().mockResolvedValue('Add command executed'),
        })
    ),
  };
});

const logger = require('../../../../src/logger');
const { createFeatureFlags } = require('../../../../src/application/services/FeatureFlags');
const { getApplicationBootstrap } = require('../../../../src/application/bootstrap/ApplicationBootstrap');

describe('CommandIntegration', () => {
  let integration;
  let mockPersonalityApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    resetCommandIntegration();
    integration = new CommandIntegration();
    
    // Create mock service required by CommandIntegration
    mockPersonalityApplicationService = {
      registerPersonality: jest.fn(),
      listPersonalitiesByOwner: jest.fn(),
      // Add other methods as needed
    };
  });

  describe('initialize', () => {
    it('should initialize with default services', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      expect(integration.initialized).toBe(true);
      expect(integration.applicationServices.featureFlags).toBeDefined();
      expect(integration.applicationServices.personalityApplicationService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        '[CommandIntegration] Successfully initialized command system'
      );
    });

    it('should initialize with custom services', async () => {
      const customServices = {
        personalityApplicationService: mockPersonalityApplicationService,
        customService: { test: true },
        featureFlags: { custom: true },
      };

      await integration.initialize(customServices);

      expect(integration.applicationServices.customService).toEqual({ test: true });
      expect(integration.applicationServices.featureFlags).toEqual({ custom: true });
    });

    it('should register commands during initialization', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      const registry = integration.registry;
      expect(registry.get('add')).toBeDefined();
      expect(registry.get('create')).toBeDefined(); // Alias
      expect(createAddCommand).toHaveBeenCalled();
    });

    it('should create platform adapters', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      expect(integration.adapters.has('discord')).toBe(true);
      expect(integration.adapters.has('revolt')).toBe(true);
    });

    it('should warn if already initialized', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      expect(logger.warn).toHaveBeenCalledWith('[CommandIntegration] Already initialized');
    });

    it('should handle initialization errors', async () => {
      const originalImpl = createAddCommand.getMockImplementation();
      createAddCommand.mockImplementation(() => {
        throw new Error('Failed to create command');
      });

      await expect(integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      })).rejects.toThrow('Failed to create command');
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandIntegration] Failed to initialize:',
        expect.any(Error)
      );

      // Restore original implementation for other tests
      createAddCommand.mockImplementation(originalImpl);
    });
  });

  describe('getAdapter', () => {
    beforeEach(async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });
    });

    it('should get Discord adapter', () => {
      const adapter = integration.getAdapter('discord');
      expect(adapter).toBeDefined();
    });

    it('should get Revolt adapter', () => {
      const adapter = integration.getAdapter('revolt');
      expect(adapter).toBeDefined();
    });

    it('should handle case-insensitive platform names', () => {
      const adapter = integration.getAdapter('DISCORD');
      expect(adapter).toBeDefined();
    });

    it('should throw for unknown platform', () => {
      expect(() => integration.getAdapter('telegram')).toThrow(
        'No adapter found for platform: telegram'
      );
    });

    it('should throw if not initialized', () => {
      const newIntegration = new CommandIntegration();
      expect(() => newIntegration.getAdapter('discord')).toThrow(
        'CommandIntegration not initialized'
      );
    });
  });

  describe('handleDiscordTextCommand', () => {
    it('should delegate to Discord adapter', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      const mockMessage = { id: 'msg123' };
      const mockAdapter = {
        handleTextCommand: jest.fn().mockResolvedValue('Result'),
      };
      integration.adapters.set('discord', mockAdapter);

      const result = await integration.handleDiscordTextCommand(mockMessage, 'add', ['test']);

      expect(mockAdapter.handleTextCommand).toHaveBeenCalledWith(mockMessage, 'add', ['test']);
      expect(result).toBe('Result');
    });
  });

  describe('handleDiscordSlashCommand', () => {
    it('should delegate to Discord adapter', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      const mockInteraction = { id: 'int123' };
      const mockAdapter = {
        handleSlashCommand: jest.fn().mockResolvedValue('Result'),
      };
      integration.adapters.set('discord', mockAdapter);

      const result = await integration.handleDiscordSlashCommand(mockInteraction);

      expect(mockAdapter.handleSlashCommand).toHaveBeenCalledWith(mockInteraction);
      expect(result).toBe('Result');
    });
  });

  describe('handleRevoltTextCommand', () => {
    it('should delegate to Revolt adapter', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      const mockMessage = { id: 'msg123' };
      const mockAdapter = {
        handleTextCommand: jest.fn().mockResolvedValue('Result'),
      };
      integration.adapters.set('revolt', mockAdapter);

      const result = await integration.handleRevoltTextCommand(mockMessage, 'add', ['test']);

      expect(mockAdapter.handleTextCommand).toHaveBeenCalledWith(mockMessage, 'add', ['test']);
      expect(result).toBe('Result');
    });
  });

  describe('registerDiscordSlashCommands', () => {
    it('should delegate to Discord adapter', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      const mockClient = { id: 'client123' };
      const mockAdapter = {
        registerSlashCommands: jest.fn().mockResolvedValue(['cmd1', 'cmd2']),
      };
      integration.adapters.set('discord', mockAdapter);

      const result = await integration.registerDiscordSlashCommands(mockClient, 'guild123');

      expect(mockAdapter.registerSlashCommands).toHaveBeenCalledWith(mockClient, 'guild123');
      expect(result).toEqual(['cmd1', 'cmd2']);
    });
  });

  describe('hasCommand', () => {
    beforeEach(async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });
    });

    it('should return true for existing command', () => {
      expect(integration.hasCommand('add')).toBe(true);
    });

    it('should return true for command alias', () => {
      expect(integration.hasCommand('create')).toBe(true);
    });

    it('should return false for non-existent command', () => {
      expect(integration.hasCommand('nonexistent')).toBe(false);
    });

    it('should have backup command registered', () => {
      expect(integration.hasCommand('backup')).toBe(true);
    });
  });

  describe('getAllCommands', () => {
    it('should return all registered commands', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });

      const commands = integration.getAllCommands();
      expect(commands).toHaveLength(21);
      expect(commands.map(c => c.name)).toEqual([
        'add',
        'remove',
        'info',
        'alias',
        'list',
        'config',
        'reset',
        'activate',
        'deactivate',
        'autorespond',
        'auth',
        'verify',
        'blacklist',
        'ping',
        'status',
        'notifications',
        'debug',
        'purgbot',
        'volumetest',
        'help',
        'backup',
      ]);
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      await integration.initialize({
        personalityApplicationService: mockPersonalityApplicationService,
      });
      integration.reset();

      expect(integration.initialized).toBe(false);
      expect(integration.registry.getAll()).toHaveLength(0);
      expect(integration.adapters.size).toBe(0);
      expect(integration.applicationServices).toEqual({});
    });
  });

  describe('singleton management', () => {
    it('should return same instance', () => {
      const instance1 = getCommandIntegration();
      const instance2 = getCommandIntegration();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getCommandIntegration();
      resetCommandIntegration();
      const instance2 = getCommandIntegration();

      expect(instance1).not.toBe(instance2);
    });
  });
});
