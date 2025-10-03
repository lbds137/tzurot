/**
 * Command integration module - Wires together the command system
 * @module application/commands/CommandIntegration
 */

const logger = require('../../logger');
const { getCommandRegistry } = require('./CommandAbstraction');
const { CommandAdapterFactory } = require('./CommandAdapter');
const { createFeatureFlags } = require('../services/FeatureFlags');
const { createAddCommand } = require('./personality/AddCommand');
const { createRemoveCommand } = require('./personality/RemoveCommand');
const { createInfoCommand } = require('./personality/InfoCommand');
const { createAliasCommand } = require('./personality/AliasCommand');
const { createListCommand } = require('./personality/ListCommand');
const { createConfigCommand } = require('./personality/ConfigCommand');
const { createResetCommand } = require('./conversation/ResetCommand');
const { createActivateCommand } = require('./conversation/ActivateCommand');
const { createDeactivateCommand } = require('./conversation/DeactivateCommand');
const { createAutorespondCommand } = require('./conversation/AutorespondCommand');
const { createAuthCommand } = require('./authentication/AuthCommand');
const { createVerifyCommand } = require('./authentication/VerifyCommand');
const { createBlacklistCommand } = require('./authentication/BlacklistCommand');
const { createPingCommand } = require('./utility/PingCommand');
const { createStatusCommand } = require('./utility/StatusCommand');
const { createNotificationsCommand } = require('./utility/NotificationsCommand');
const { createDebugCommand } = require('./utility/DebugCommand');
const { createPurgbotCommand } = require('./utility/PurgbotCommand');
const { createVolumeTestCommand } = require('./utility/VolumeTestCommand');
const { createHelpCommand } = require('./utility/HelpCommand');
const { createBackupCommand } = require('./utility/BackupCommand');

/**
 * Initialize the command system with all commands and services
 */
class CommandIntegration {
  constructor() {
    this.registry = getCommandRegistry();
    this.adapters = new Map();
    this.applicationServices = {};
    this.initialized = false;
  }

  /**
   * Initialize with application services
   */
  async initialize(applicationServices = {}) {
    if (this.initialized) {
      logger.warn('[CommandIntegration] Already initialized');
      return;
    }

    try {
      // Store application services - require them to be passed in to avoid circular dependencies
      this.applicationServices = {
        featureFlags: applicationServices.featureFlags || createFeatureFlags(),
        ...applicationServices,
      };

      // Validate required services
      if (!this.applicationServices.personalityApplicationService) {
        throw new Error('personalityApplicationService is required for CommandIntegration');
      }

      // Register all commands
      await this._registerCommands();

      // Create platform adapters
      this._createAdapters();

      this.initialized = true;
      logger.info('[CommandIntegration] Successfully initialized command system');
    } catch (error) {
      logger.error('[CommandIntegration] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Register all available commands
   */
  async _registerCommands() {
    // Clear existing commands
    this.registry.clear();

    // Register personality commands
    this.registry.register(createAddCommand());
    this.registry.register(createRemoveCommand());
    this.registry.register(createInfoCommand());
    this.registry.register(createAliasCommand());
    this.registry.register(createListCommand());
    this.registry.register(createConfigCommand());

    // Register conversation commands
    this.registry.register(createResetCommand());
    this.registry.register(createActivateCommand());
    this.registry.register(createDeactivateCommand());
    this.registry.register(createAutorespondCommand());

    // Register authentication commands
    this.registry.register(createAuthCommand());
    this.registry.register(createVerifyCommand());
    this.registry.register(createBlacklistCommand());

    // Register utility commands
    this.registry.register(createPingCommand());
    this.registry.register(createStatusCommand());
    this.registry.register(createNotificationsCommand());
    this.registry.register(createDebugCommand());
    this.registry.register(createPurgbotCommand());
    this.registry.register(createVolumeTestCommand());
    this.registry.register(createHelpCommand());
    this.registry.register(createBackupCommand());

    logger.info(`[CommandIntegration] Registered ${this.registry.getAll().length} commands`);
  }

  /**
   * Create platform adapters
   */
  _createAdapters() {
    // Create Discord adapter
    const discordAdapter = CommandAdapterFactory.create('discord', {
      commandRegistry: this.registry,
      applicationServices: this.applicationServices,
    });
    this.adapters.set('discord', discordAdapter);

    // Create Revolt adapter
    const revoltAdapter = CommandAdapterFactory.create('revolt', {
      commandRegistry: this.registry,
      applicationServices: this.applicationServices,
    });
    this.adapters.set('revolt', revoltAdapter);
  }

  /**
   * Get adapter for platform
   */
  getAdapter(platform) {
    if (!this.initialized) {
      throw new Error('CommandIntegration not initialized');
    }

    const adapter = this.adapters.get(platform.toLowerCase());
    if (!adapter) {
      throw new Error(`No adapter found for platform: ${platform}`);
    }

    return adapter;
  }

  /**
   * Handle Discord text command
   */
  async handleDiscordTextCommand(message, commandName, args) {
    const adapter = this.getAdapter('discord');
    return await adapter.handleTextCommand(message, commandName, args);
  }

  /**
   * Handle Discord slash command
   */
  async handleDiscordSlashCommand(interaction) {
    const adapter = this.getAdapter('discord');
    return await adapter.handleSlashCommand(interaction);
  }

  /**
   * Handle Revolt text command
   */
  async handleRevoltTextCommand(message, commandName, args) {
    const adapter = this.getAdapter('revolt');
    return await adapter.handleTextCommand(message, commandName, args);
  }

  /**
   * Register Discord slash commands
   */
  async registerDiscordSlashCommands(client, guildId = null) {
    const adapter = this.getAdapter('discord');
    return await adapter.registerSlashCommands(client, guildId);
  }

  /**
   * Check if a command exists (by name or alias)
   */
  hasCommand(nameOrAlias) {
    return this.registry.get(nameOrAlias) !== null;
  }

  /**
   * Get all commands
   */
  getAllCommands() {
    return this.registry.getAll();
  }

  /**
   * Get the command registry (for advanced usage)
   */
  getRegistry() {
    return this.registry;
  }

  /**
   * Reset (for testing)
   */
  reset() {
    this.registry.clear();
    this.adapters.clear();
    this.applicationServices = {};
    this.initialized = false;
  }
}

// Create singleton instance
let instance = null;

/**
 * Get the command integration singleton
 */
function getCommandIntegration() {
  if (!instance) {
    instance = new CommandIntegration();
  }
  return instance;
}

/**
 * Reset the integration (for testing)
 */
function resetCommandIntegration() {
  if (instance) {
    instance.reset();
  }
  instance = null;
}

module.exports = {
  CommandIntegration,
  getCommandIntegration,
  resetCommandIntegration,
};
