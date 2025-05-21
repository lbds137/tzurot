/**
 * Command Registry - Manages registration and retrieval of command handlers
 */
const logger = require('../../logger');

class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  /**
   * Register a command with its metadata and handler
   * @param {Object} commandModule - The command module containing meta and execute function
   */
  register(commandModule) {
    if (!commandModule.meta || !commandModule.execute) {
      throw new Error('Command module must have meta and execute properties');
    }

    const { meta } = commandModule;

    // Validate required meta properties
    if (!meta.name) {
      throw new Error('Command must have a name');
    }

    // Register the command by its name
    this.commands.set(meta.name, commandModule);
    logger.debug(`[CommandRegistry] Registered command: ${meta.name}`);

    // Register any aliases
    if (meta.aliases && Array.isArray(meta.aliases)) {
      meta.aliases.forEach(alias => {
        this.aliases.set(alias, meta.name);
        logger.debug(`[CommandRegistry] Registered alias: ${alias} -> ${meta.name}`);
      });
    }
  }

  /**
   * Get a command by name or alias
   * @param {string} nameOrAlias - Command name or alias
   * @returns {Object|null} Command module or null if not found
   */
  get(nameOrAlias) {
    // Try direct command lookup
    if (this.commands.has(nameOrAlias)) {
      return this.commands.get(nameOrAlias);
    }

    // Try alias lookup
    const commandName = this.aliases.get(nameOrAlias);
    if (commandName) {
      return this.commands.get(commandName);
    }

    // Command not found
    return null;
  }

  /**
   * Check if a command exists by name or alias
   * @param {string} nameOrAlias - Command name or alias
   * @returns {boolean} Whether the command exists
   */
  has(nameOrAlias) {
    return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias);
  }

  /**
   * Get all registered commands
   * @returns {Map} Map of command name to command module
   */
  getAllCommands() {
    return this.commands;
  }

  /**
   * Get all commands matching a filter
   * @param {Function} filterFn - Filter function (meta) => boolean
   * @returns {Array} Array of command modules
   */
  getFilteredCommands(filterFn) {
    return Array.from(this.commands.values()).filter(command => filterFn(command.meta));
  }
}

// Export a singleton instance
const registry = new CommandRegistry();
module.exports = registry;
