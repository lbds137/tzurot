/**
 * Notifications Command Group
 *
 * User-facing release-notes DM preferences (stored on the user row via
 * api-gateway; delivery itself ships separately):
 *
 * - /notifications view — current settings + how levels work
 * - /notifications enable|disable — master switch (default: enabled)
 * - /notifications level — minimum changelog-derived release weight worth a DM
 * - /notifications cleanup — delete your release-notes DMs on demand
 */

import { SlashCommandBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { handleNotificationsView } from './view.js';
import { handleNotificationsEnable, handleNotificationsDisable } from './toggle.js';
import { handleNotificationsLevel } from './level.js';
import { handleNotificationsCleanup } from './cleanup.js';

const logger = createLogger('notifications-command');

const router = createTypedSubcommandRouter(
  {
    view: handleNotificationsView,
    enable: handleNotificationsEnable,
    disable: handleNotificationsDisable,
    level: handleNotificationsLevel,
    cleanup: handleNotificationsCleanup,
  },
  { logger, logPrefix: '[Notifications]' }
);

async function execute(context: SafeCommandContext): Promise<void> {
  await router(context as DeferredCommandContext);
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Manage release-notes DM notifications')
    .addSubcommand(sub => sub.setName('view').setDescription('Show your notification settings'))
    .addSubcommand(sub => sub.setName('enable').setDescription('Enable release-notes DMs'))
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable release-notes DMs'))
    .addSubcommand(sub =>
      sub.setName('cleanup').setDescription('Delete release-notes DMs from your DM channel')
    )
    .addSubcommand(sub =>
      sub
        .setName('level')
        .setDescription('Set the minimum release weight worth a DM')
        .addStringOption(opt =>
          opt
            .setName('level')
            .setDescription('Releases below this weight are skipped')
            .setRequired(true)
            .addChoices(
              { name: 'Major — breaking changes only', value: 'major' },
              { name: 'Minor — features and breaking changes (default)', value: 'minor' },
              { name: 'Patch — every release, including fix-only', value: 'patch' }
            )
        )
    ),
  deferralMode: 'ephemeral',
  execute,
});
