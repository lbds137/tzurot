/**
 * Discord.js Type Augmentation
 *
 * Extends the Discord.js Client interface to include our custom properties.
 * This allows type-safe access to `client.commands` throughout the codebase.
 */

import type { Collection } from 'discord.js';
import type { Command } from '../types.js';

declare module 'discord.js' {
  interface Client {
    /**
     * Collection of loaded slash commands.
     * Attached during bot startup after CommandHandler.loadCommands().
     * Used by commands like /help to access all available commands.
     */
    commands: Collection<string, Command>;
  }
}
