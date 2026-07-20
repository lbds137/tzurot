/**
 * Admin Broadcast Subcommand
 * Handles /admin broadcast — DM blast through the release-broadcast pipeline.
 *
 * Receives DeferredCommandContext (no deferReply method!) because the parent
 * command uses deferralMode: 'ephemeral'.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { UX_SENTINELS } from '@tzurot/common-types/constants/uxVocabulary';
import type { NotifyLevelValue } from '@tzurot/common-types/schemas/api/notifications';
import { adminBroadcastOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-broadcast');

const BROADCAST_RESOURCE = 'broadcast';

export async function handleBroadcast(context: DeferredCommandContext): Promise<void> {
  const options = adminBroadcastOptions(context.interaction);
  const message = options.message();
  // The slash command exposes exactly the three enum choices, so the cast is
  // sound; the server schema re-validates anyway.
  const level = (options.level() ?? 'major') as NotifyLevelValue;
  const label = options.label() ?? undefined;
  const dryRun = options['dry-run']() ?? false;
  const confirm = options.confirm() ?? false;

  // Friendly early gate; the gateway schema enforces the same rule
  // authoritatively (a client bypass still can't send unconfirmed).
  if (!dryRun && !confirm) {
    await context.editReply({
      content:
        '⚠️ A real send has no undo. Preview with `dry-run:true`, then send with `confirm:true`.',
    });
    return;
  }

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.broadcast({ message, level, label, dryRun, confirm });

    if (!result.ok) {
      logger.error({ status: result.status, error: result.error, dryRun }, 'Broadcast failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, BROADCAST_RESOURCE, {
            failedAction: dryRun ? 'resolve the broadcast audience' : 'enqueue the broadcast',
          })
        ),
      });
      return;
    }

    const data = result.data;
    if (data.dryRun) {
      const sampleText =
        data.sample.length > 0
          ? data.sample.map(entry => `• ${entry.username}`).join('\n')
          : UX_SENTINELS.NOT_SET;
      const embed = new EmbedBuilder()
        .setColor(DISCORD_COLORS.WARNING)
        .setTitle('📢 Broadcast — dry run')
        .setDescription(
          `Would DM **${data.eligibleCount}** opted-in user(s) at level **${level}**. Nothing was sent.`
        )
        .addFields({ name: `Sample (first ${data.sample.length})`, value: sampleText })
        .setTimestamp();
      await context.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('📢 Broadcast enqueued')
      .setDescription(
        `Version **${data.version}** → **${data.recipients}** recipient(s) across **${data.batches}** batch(es). ` +
          'Delivery outcomes land in the release delivery log.'
      )
      .setTimestamp();
    await context.editReply({ embeds: [embed] });
    logger.info(
      { version: data.version, recipients: data.recipients, batches: data.batches },
      'Broadcast enqueued'
    );
  } catch (error) {
    logger.error({ err: error, dryRun }, 'Broadcast error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, BROADCAST_RESOURCE, {
          failedAction: dryRun ? 'resolve the broadcast audience' : 'enqueue the broadcast',
        })
      ),
    });
  }
}
