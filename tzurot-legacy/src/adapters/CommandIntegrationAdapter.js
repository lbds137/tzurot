/**
 * Adapter to integrate CommandIntegration system with existing bot message handler
 * @module adapters/CommandIntegrationAdapter
 */

const logger = require('../logger');
const { getCommandIntegration } = require('../application/commands/CommandIntegration');

/**
 * CommandIntegrationAdapter - Routes commands to the DDD command system
 */
class CommandIntegrationAdapter {
  constructor(options = {}) {
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

      // Initialize the command system
      await this.commandIntegration.initialize(applicationServices);

      this.initialized = true;
      logger.info('[CommandIntegrationAdapter] Successfully initialized');
    } catch (error) {
      logger.error('[CommandIntegrationAdapter] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Process a command using the DDD system
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

      // Check if this command exists
      const hasCommand = this.commandIntegration.hasCommand(commandName);
      if (!hasCommand) {
        logger.debug(`[CommandIntegrationAdapter] Command "${commandName}" not found`);
        return {
          success: false,
          error: `Unknown command: ${commandName}`,
        };
      }

      logger.info(`[CommandIntegrationAdapter] Processing command "${commandName}"`);

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
      logger.error('[CommandIntegrationAdapter] Error processing command:', error);

      // Return error response instead of throwing
      return {
        success: false,
        error: error.message || 'An error occurred processing the command',
      };
    }
  }

  /**
   * Register Discord slash commands
   */
  async registerSlashCommands(client, guildId = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    return await this.commandIntegration.registerDiscordSlashCommands(client, guildId);
  }

  /**
   * Get command list for help display
   */
  getCommandList() {
    if (!this.initialized) {
      return [];
    }

    const commands = this.commandIntegration.getAllCommands();
    return commands.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      aliases: cmd.aliases,
    }));
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
