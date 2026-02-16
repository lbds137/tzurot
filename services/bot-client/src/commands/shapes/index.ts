/**
 * Shapes Command Group
 *
 * Import and export character data from shapes.inc:
 *
 * - /shapes auth - Authenticate with shapes.inc session cookie
 * - /shapes logout - Remove stored credentials
 * - /shapes import <slug> - Import character into Tzurot
 * - /shapes status - View credential status and import history
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import { handleAuth } from './auth.js';
import { handleLogout } from './logout.js';
import { handleImport } from './import.js';
import { handleStatus } from './status.js';
import { handleShapesModalSubmit } from './modal.js';

const logger = createLogger('shapes-command');

const shapesRouter = createMixedModeSubcommandRouter(
  {
    deferred: {
      logout: handleLogout,
      import: handleImport,
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
      subcommand
        .setName('import')
        .setDescription('Import a shapes.inc character into Tzurot')
        .addStringOption(option =>
          option
            .setName('slug')
            .setDescription('The shapes.inc character username/slug')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('status').setDescription('View credential status and import history')
    ),
  execute: shapesRouter,
  handleModal,
});
