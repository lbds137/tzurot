/**
 * Command Handler
 *
 * Loads slash commands from the commands directory and routes the
 * non-chat-input interaction surfaces: modal submits, autocomplete,
 * components, and context-menu commands. Simple, modular approach - just
 * scan files and build a Map.
 *
 * Chat-input (slash) dispatch is NOT here: it lives in
 * `handlers/commandDispatch.ts`, which owns deferral-mode resolution and
 * context creation and calls the loaded command's `execute`.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  Collection,
  ContextMenuCommandBuilder,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type AutocompleteInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  MessageFlags,
} from 'discord.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import { replySpecSafe, topLevelErrorSpec } from '../ux/render/reply.js';
import {
  runWithOutcomeSlot,
  type CommandOutcomeSlot,
} from '../observability/commandOutcomeSlot.js';
import { emitCommandEvent } from '../observability/emitCommandEvent.js';
import { reportError } from '../observability/ErrorChannelReporter.js';
import {
  classifyChannelKind,
  classifyErrorCode,
} from '../observability/commandTelemetryClassify.js';
import type { RecordCommandEventRequest } from '../observability/recordCommandEvent.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { Command, ContextMenuCommand } from '../types.js';
import {
  VALID_COMMAND_KEYS,
  VALID_CONTEXT_MENU_COMMAND_KEYS,
  type CommandDefinition,
  type ContextMenuCommandDefinition,
} from '../utils/defineCommand.js';
import { getCommandFromCustomId } from '../utils/customIds.js';
import { getCommandFiles } from '../utils/commandFileUtils.js';

const logger = createLogger('CommandHandler');

// Get directory name for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Category from the command's directory (e.g. commands/memory/… → 'Memory'). */
function deriveCategory(filePath: string, commandsPath: string): string | undefined {
  const relativePath = filePath.replace(commandsPath, '');
  const pathParts = relativePath.split('/').filter(Boolean);
  return pathParts.length > 1
    ? pathParts[0].charAt(0).toUpperCase() + pathParts[0].slice(1)
    : undefined;
}

/**
 * Command Handler - manages command registration and non-chat-input routing
 *
 * Uses a prefix-to-command map for component routing:
 * - Command name is automatically registered as a prefix
 * - Commands can declare additional prefixes via componentPrefixes
 * - Collision detection prevents duplicate prefix registration
 */
export class CommandHandler {
  private commands: Collection<string, Command>;
  private contextMenuCommands: Collection<string, ContextMenuCommand>;
  private prefixToCommand: Map<string, Command>;

  constructor() {
    this.commands = new Collection();
    this.contextMenuCommands = new Collection();
    this.prefixToCommand = new Map();
  }

  /**
   * Register a prefix for a command with collision detection
   * @throws Error if prefix is already registered to a different command
   */
  private registerPrefix(prefix: string, command: Command): void {
    const existing = this.prefixToCommand.get(prefix);
    if (existing !== undefined && existing !== command) {
      throw new Error(
        `Prefix collision: '${prefix}' is already registered to '${existing.data.name}' ` +
          `but '${command.data.name}' tried to claim it`
      );
    }
    this.prefixToCommand.set(prefix, command);
  }

  /**
   * Load and register a single command file.
   * @throws Error if command exports unknown properties (typo detection)
   */
  private async loadSingleCommand(filePath: string, commandsPath: string): Promise<void> {
    const fileUrl = pathToFileURL(filePath).href;
    const importedModule = (await import(fileUrl)) as Record<string, unknown>;

    // Command entry points MUST default-export their Command (the shape
    // `defineCommand` returns). A module with no default export falls through
    // to the validation below and is skipped as an invalid command file.
    const cmdDef = importedModule.default as Partial<Command> | undefined;

    // Validate command structure
    if (
      cmdDef?.data === undefined ||
      cmdDef.data === null ||
      cmdDef.execute === undefined ||
      cmdDef.execute === null
    ) {
      logger.warn({ filePath }, 'Invalid command file');
      return;
    }

    // Context-menu commands register into their own map: none of the slash
    // surfaces (autocomplete, component routing, deferral modes) apply.
    if (cmdDef.data instanceof ContextMenuCommandBuilder) {
      this.loadContextMenuCommand(
        cmdDef as unknown as ContextMenuCommandDefinition,
        filePath,
        commandsPath
      );
      return;
    }

    // Runtime validation: fail fast on unknown properties (catches typos like handleModalSubmit)
    for (const key of Object.keys(cmdDef)) {
      if (!VALID_COMMAND_KEYS.includes(key as keyof CommandDefinition)) {
        throw new Error(
          `Command "${cmdDef.data.name}" exports unknown property "${key}". ` +
            `Valid properties: ${VALID_COMMAND_KEYS.join(', ')}. ` +
            `Did you typo a handler name?`
        );
      }
    }

    // Determine category based on directory structure (DRY - no manual declaration needed)
    const category = deriveCategory(filePath, commandsPath);

    // Create command object with category (don't mutate the imported module)
    const commandWithCategory: Command = {
      data: cmdDef.data,
      deferralMode: cmdDef.deferralMode,
      subcommandDeferralModes: cmdDef.subcommandDeferralModes,
      execute: cmdDef.execute,
      autocomplete: cmdDef.autocomplete,
      handleSelectMenu: cmdDef.handleSelectMenu,
      handleButton: cmdDef.handleButton,
      handleModal: cmdDef.handleModal,
      componentPrefixes: cmdDef.componentPrefixes,
      category,
    };

    const commandName = cmdDef.data.name;
    this.commands.set(commandName, commandWithCategory);

    // Register command name as a prefix for component routing
    this.registerPrefix(commandName, commandWithCategory);

    // Register any additional prefixes declared by the command
    if (commandWithCategory.componentPrefixes !== undefined) {
      for (const prefix of commandWithCategory.componentPrefixes) {
        this.registerPrefix(prefix, commandWithCategory);
      }
    }

    logger.info({ commandName }, 'Loaded command');
  }

  /** Register a context-menu command (validated shape, derived category). */
  private loadContextMenuCommand(
    cmdDef: ContextMenuCommandDefinition,
    filePath: string,
    commandsPath: string
  ): void {
    for (const key of Object.keys(cmdDef)) {
      if (!VALID_CONTEXT_MENU_COMMAND_KEYS.includes(key as keyof ContextMenuCommandDefinition)) {
        throw new Error(
          `Context-menu command "${cmdDef.data.name}" exports unknown property "${key}". ` +
            `Valid properties: ${VALID_CONTEXT_MENU_COMMAND_KEYS.join(', ')}.`
        );
      }
    }

    this.contextMenuCommands.set(cmdDef.data.name, {
      data: cmdDef.data,
      execute: cmdDef.execute,
      category: deriveCategory(filePath, commandsPath),
    });

    logger.info({ commandName: cmdDef.data.name }, 'Loaded context-menu command');
  }

  /**
   * Handle a message context-menu invocation. The dispatcher owns the ack:
   * defer EPHEMERAL before the handler runs (context-menu results are
   * personal inspections, and deferring here keeps the 3-second rule out of
   * every handler's hands), then the handler replies via editReply.
   */
  async handleContextMenuCommand(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    const command = this.contextMenuCommands.get(interaction.commandName);
    if (command === undefined) {
      logger.warn({ commandName: interaction.commandName }, 'Unknown context-menu command');
      await interaction.reply({ content: 'Unknown command!', flags: MessageFlags.Ephemeral });
      return;
    }

    // Started AFTER the unknown-command early return above, so that path
    // stays untimed and unemitted (there is no command to attribute an event
    // to). Context-menu commands have no subcommands, so the telemetry
    // command name is just the bare commandName.
    const startedAt = Date.now();
    const slot: CommandOutcomeSlot = {};

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (deferError) {
      // A failed defer leaves nothing to reply to and no invocation ran —
      // log and bail without emitting telemetry, mirroring the chat-input
      // dispatcher's defer-failure handling.
      logger.error(
        { err: deferError, commandName: interaction.commandName },
        'Failed to defer context-menu interaction'
      );
      return;
    }
    try {
      await runWithOutcomeSlot(slot, () => command.execute(interaction));
    } catch (error) {
      logger.error(
        { err: error, commandName: interaction.commandName },
        'Context-menu command failed'
      );
      slot.outcome = 'system_error';
      slot.errorCode = classifyErrorCode(error);
      reportError({
        source: 'command',
        errorCode: slot.errorCode,
        command: interaction.commandName,
        latencyMs: Date.now() - startedAt,
        error,
      });
      await replySpecSafe(interaction, topLevelErrorSpec(error, CATALOG.error.commandFailed()));
    }

    const event: RecordCommandEventRequest = {
      userId: interaction.user.id,
      ...(interaction.guildId !== null ? { guildId: interaction.guildId } : {}),
      channelKind: classifyChannelKind(interaction),
      command: interaction.commandName,
      // characterId/context omitted: see the chat-input dispatcher's same
      // omission in commandDispatch.ts for the rationale.
      outcome: slot.outcome ?? 'ok',
      ...(slot.errorCode !== undefined ? { errorCode: slot.errorCode } : {}),
      latencyMs: Date.now() - startedAt,
    };
    emitCommandEvent(event);
  }

  /** Loaded context-menu commands (manifest + tests). */
  getContextMenuCommands(): Collection<string, ContextMenuCommand> {
    return this.contextMenuCommands;
  }

  /**
   * Load all commands from the commands directory
   */
  async loadCommands(): Promise<void> {
    const commandsPath = join(__dirname, '../commands');
    const commandFiles = getCommandFiles(commandsPath);

    logger.info({ count: commandFiles.length }, 'Loading command files');

    for (const filePath of commandFiles) {
      try {
        await this.loadSingleCommand(filePath, commandsPath);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, filePath, errorMessage }, 'Failed to load command');
      }
    }

    logger.info({ count: this.commands.size }, 'Loaded commands');
  }

  /**
   * Handle a modal submit interaction
   * Routes via prefix map and uses handleModal if available
   */
  async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = interaction.customId;
    const prefix = getCommandFromCustomId(customId) ?? customId;

    // Look up command by prefix
    const command = this.prefixToCommand.get(prefix);

    if (!command) {
      logger.warn({ customId, prefix }, 'Unknown prefix for modal');
      await interaction.reply({
        content: 'Unknown interaction!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const commandName = command.data.name;

    try {
      // Commands must export handleModal to handle modal submissions
      if (command.handleModal !== undefined) {
        logger.info({ commandName }, 'Executing modal handler');
        await command.handleModal(interaction);
      } else {
        logger.warn(
          { commandName, customId },
          `Command "${commandName}" received modal but doesn't export handleModal`
        );
        await interaction.reply({
          content: 'This command does not support modal interactions.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (error) {
      logger.error({ err: error, customId }, `Error in modal: ${commandName}`);
      await replySpecSafe(
        interaction,
        topLevelErrorSpec(error, CATALOG.error.interactionFailed()),
        {
          logContext: { customId },
        }
      );
    }
  }

  /**
   * Handle an autocomplete interaction
   */
  async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.warn({ commandName: interaction.commandName }, 'Unknown command for autocomplete');
      await interaction.respond([]);
      return;
    }

    if (!command.autocomplete) {
      logger.warn({ commandName: interaction.commandName }, 'No autocomplete handler for command');
      await interaction.respond([]);
      return;
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error({ err: error }, `Error in autocomplete for: ${interaction.commandName}`);
      await interaction.respond([]);
    }
  }

  /**
   * Handle a component interaction (select menu or button)
   *
   * Routes based on customId prefix using the prefixToCommand map.
   * Commands declare their prefixes via componentPrefixes.
   */
  async handleComponentInteraction(
    interaction: StringSelectMenuInteraction | ButtonInteraction
  ): Promise<void> {
    const customId = interaction.customId;
    const prefix = getCommandFromCustomId(customId) ?? customId;

    // Look up command by prefix
    const command = this.prefixToCommand.get(prefix);

    if (!command) {
      logger.warn({ customId, prefix }, 'Unknown prefix for component');
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Unknown interaction!',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const commandName = command.data.name;

    try {
      if (interaction.isStringSelectMenu()) {
        if (!command.handleSelectMenu) {
          logger.warn({ customId, commandName }, 'No select menu handler for command');
          return;
        }
        logger.info({ commandName }, 'Executing select menu handler');
        await command.handleSelectMenu(interaction);
      } else if (interaction.isButton()) {
        if (!command.handleButton) {
          logger.warn({ customId, commandName }, 'No button handler for command');
          return;
        }
        logger.info({ commandName }, 'Executing button handler');
        await command.handleButton(interaction);
      }
    } catch (error) {
      logger.error({ err: error, customId, commandName }, 'Error in component interaction');
      await replySpecSafe(
        interaction,
        topLevelErrorSpec(error, CATALOG.error.interactionFailed()),
        {
          logContext: { customId },
        }
      );
    }
  }

  /**
   * Get all loaded commands (for deployment script)
   */
  getCommands(): Collection<string, Command> {
    return this.commands;
  }

  /**
   * Get a specific command by name
   */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }
}
