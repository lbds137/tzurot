/**
 * Adapter to integrate new CommandIntegration system with existing bot message handler
 * This allows gradual migration from legacy to new command system
 * @module adapters/CommandIntegrationAdapter
 */

const logger = require('../logger');
const { getFeatureFlags } = require('../application/services/FeatureFlags');
const { getCommandIntegration } = require('../application/commands/CommandIntegration');
const { processCommand: processLegacyCommand } = require('../commandLoader');

/**
 * CommandIntegrationAdapter - Routes commands between legacy and new systems
 */
class CommandIntegrationAdapter {
  constructor(options = {}) {
    this.featureFlags = options.featureFlags || getFeatureFlags();
    this.commandIntegration = options.commandIntegration || getCommandIntegration();
    this.initialized = false;
    this.initializePromise = null;
  }

  /**
   * Initialize the adapter and command integration system
   */
  async initialize(applicationServices = {}) {
    if (this.initialized) {
      return;
    }

    // Prevent concurrent initialization
    if (this.initializePromise) {
      return await this.initializePromise;
    }

    this.initializePromise = this._doInitialize(applicationServices);
    await this.initializePromise;
    this.initializePromise = null;
  }

  async _doInitialize(applicationServices) {
    try {
      logger.info('[CommandIntegrationAdapter] Initializing...');

      // Initialize the new command system
      await this.commandIntegration.initialize(applicationServices);

      this.initialized = true;
      logger.info('[CommandIntegrationAdapter] Successfully initialized');
    } catch (error) {
      logger.error('[CommandIntegrationAdapter] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Process a command, routing to appropriate system based on feature flags
   * @param {Object} message - Discord message object
   * @param {string} commandName - Command name
   * @param {Array<string>} args - Command arguments
   * @returns {Promise<Object>} Command result
   */
  async processCommand(message, commandName, args) {
    try {
      // Ensure we're initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // Check if this command exists in the new system
      const hasNewCommand = this.commandIntegration.hasCommand(commandName);
      logger.debug(
        `[CommandIntegrationAdapter] Command "${commandName}" exists in new system: ${hasNewCommand}`
      );

      // Check feature flags for this command
      const useNewSystem = this.shouldUseNewSystem(commandName, hasNewCommand);

      logger.info(
        `[CommandIntegrationAdapter] Processing command "${commandName}" using ${useNewSystem ? 'new' : 'legacy'} system`
      );

      if (useNewSystem) {
        // Route to new system
        return await this.processNewCommand(message, commandName, args);
      } else {
        // Route to legacy system
        return await this.processLegacyCommand(message, commandName, args);
      }
    } catch (error) {
      logger.error('[CommandIntegrationAdapter] Error processing command:', error);

      // Return error response instead of throwing
      return {
        success: false,
        error: error.message || 'An error occurred processing the command',
      };
    }
  }

  /**
   * Determine if we should use the new system for a command
   */
  shouldUseNewSystem(commandName, hasNewCommand) {
    // If command doesn't exist in new system, use legacy
    if (!hasNewCommand) {
      logger.debug(
        `[CommandIntegrationAdapter] Command "${commandName}" not in new system, using legacy`
      );
      return false;
    }

    // Check global feature flag - if enabled, use new system
    const globalEnabled = this.featureFlags.isEnabled('ddd.commands.enabled');
    if (!globalEnabled) {
      logger.debug(
        `[CommandIntegrationAdapter] Global DDD commands disabled, using legacy for "${commandName}"`
      );
      return false;
    }

    // Global flag is enabled, use new system
    logger.debug(
      `[CommandIntegrationAdapter] Using new system for "${commandName}" (global flag enabled)`
    );
    return true;
  }


  /**
   * Process command using new DDD system
   */
  async processNewCommand(message, commandName, args) {
    try {
      // Log for monitoring
      logger.info(`[CommandIntegrationAdapter] Routing to new system: ${commandName}`);

      // Use the Discord text command handler
      const result = await this.commandIntegration.handleDiscordTextCommand(
        message,
        commandName,
        args
      );

      return {
        success: true,
        result,
      };
    } catch (error) {
      logger.error('[CommandIntegrationAdapter] New system error:', error);

      // Optionally fall back to legacy on error
      if (this.featureFlags.isEnabled('ddd.commands.fallbackOnError')) {
        logger.warn('[CommandIntegrationAdapter] Falling back to legacy system due to error');
        return await this.processLegacyCommand(message, commandName, args);
      }

      throw error;
    }
  }

  /**
   * Process command using legacy system
   */
  async processLegacyCommand(message, commandName, args) {
    logger.info(`[CommandIntegrationAdapter] Routing to legacy system: ${commandName}`);

    // Call legacy processor with correct arguments
    const result = await processLegacyCommand(message, commandName, args);

    return {
      success: true,
      result,
    };
  }

  /**
   * Register Discord slash commands (new system only)
   */
  async registerSlashCommands(client, guildId = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.featureFlags.isEnabled('ddd.commands.slash')) {
      logger.info('[CommandIntegrationAdapter] Slash commands disabled by feature flag');
      return;
    }

    return await this.commandIntegration.registerDiscordSlashCommands(client, guildId);
  }

  /**
   * Get command list for help display
   */
  getCommandList() {
    const commands = [];

    // Get legacy commands (if still enabled)
    if (!this.featureFlags.isEnabled('ddd.commands.hideLegacy')) {
      // TODO: Get from legacy system
    }

    // Get new commands
    if (this.initialized) {
      const newCommands = this.commandIntegration.getAllCommands();
      newCommands.forEach(cmd => {
        if (this.shouldUseNewSystem(cmd.name, true)) {
          commands.push({
            name: cmd.name,
            description: cmd.description,
            aliases: cmd.aliases,
            isNew: true, // Mark as new for help display
          });
        }
      });
    }

    return commands;
  }

  /**
   * Check if adapter is ready
   */
  isReady() {
    return this.initialized;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the command integration adapter singleton
 */
function getCommandIntegrationAdapter() {
  if (!instance) {
    instance = new CommandIntegrationAdapter();
  }
  return instance;
}

module.exports = {
  CommandIntegrationAdapter,
  getCommandIntegrationAdapter,
};
