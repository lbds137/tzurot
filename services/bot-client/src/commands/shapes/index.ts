/**
 * Shapes Command Group
 *
 * Import and export character data from shapes.inc:
 *
 * - /shapes auth - Authenticate with shapes.inc session cookie
 * - /shapes logout - Remove stored credentials
 * - /shapes list - Browse owned shapes
 * - /shapes import <slug> - Import character into Tzurot
 * - /shapes export <slug> - Export character data as JSON
 * - /shapes status - View credential status and import history
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import { handleAuth } from './auth.js';
import { handleLogout } from './logout.js';
import { handleList } from './list.js';
import { handleImport } from './import.js';
import { handleExport } from './export.js';
import { handleStatus } from './status.js';
import { handleShapesModalSubmit } from './modal.js';

const logger = createLogger('shapes-command');

const shapesRouter = createMixedModeSubcommandRouter(
  {
    deferred: {
      logout: handleLogout,
      list: handleList,
      import: handleImport,
      export: handleExport,
      status: handleStatus,
    },
    modal: {
      auth: handleAuth,
    },
  },
  { logger, logPrefix: '[Shapes]' }
);

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  await handleShapesModalSubmit(interaction);
}

export default defineCommand({
  deferralMode: 'ephemeral',
  subcommandDeferralModes: {
    auth: 'modal',
  },
  data: new SlashCommandBuilder()
    .setName('shapes')
    .setDescription('Import and export character data from shapes.inc')
    .addSubcommand(subcommand =>
      subcommand.setName('auth').setDescription('Authenticate with your shapes.inc session cookie')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('logout').setDescription('Remove your stored shapes.inc credentials')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('Browse your owned shapes.inc characters')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('import')
        .setDescription('Import a shapes.inc character into Tzurot')
        .addStringOption(option =>
          option
            .setName('slug')
            .setDescription('The shapes.inc character username/slug')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('import_type')
            .setDescription('Import type (default: full)')
            .addChoices(
              { name: 'Full Character', value: 'full' },
              { name: 'Memory Only', value: 'memory_only' }
            )
        )
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('Target personality for memory_only import (required for Memory Only)')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('export')
        .setDescription('Export a shapes.inc character data')
        .addStringOption(option =>
          option
            .setName('slug')
            .setDescription('The shapes.inc character username/slug')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('format')
            .setDescription('Export format (default: json)')
            .addChoices({ name: 'JSON', value: 'json' }, { name: 'Markdown', value: 'markdown' })
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('status').setDescription('View credential status and import history')
    ),
  execute: shapesRouter,
  handleModal,
});
