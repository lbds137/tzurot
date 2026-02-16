/**
 * Shapes Export Subcommand
 *
 * Fetches full character data from shapes.inc and returns it as
 * a downloadable JSON file attachment in Discord.
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('shapes-export');

/** Discord file size limit (8MB) */
const DISCORD_FILE_LIMIT = 8 * 1024 * 1024;

/** Extended timeout for export — fetching all memories can be slow */
const EXPORT_TIMEOUT = 120_000;

interface ExportResponse {
  exportedAt: string;
  sourceSlug: string;
  config: Record<string, unknown>;
  memories: unknown[];
  stories: unknown[];
  userPersonalization: Record<string, unknown> | null;
  stats: {
    memoriesCount: number;
    storiesCount: number;
    hasUserPersonalization: boolean;
  };
}

/**
 * Handle /shapes export <slug> subcommand
 * Fetches data from shapes.inc and sends as Discord file attachment
 */
export async function handleExport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const slug = context.interaction.options.getString('slug', true).trim().toLowerCase();

  try {
    // Show progress message
    await context.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(DISCORD_COLORS.WARNING)
          .setTitle('⏳ Exporting...')
          .setDescription(
            `Fetching all data for **${slug}** from shapes.inc.\n` +
              'This may take a minute for characters with many memories.'
          ),
      ],
    });

    const result = await callGatewayApi<ExportResponse>('/user/shapes/export', {
      method: 'POST',
      userId,
      body: { slug },
      timeout: EXPORT_TIMEOUT,
    });

    if (!result.ok) {
      await handleExportError(context, result, slug);
      return;
    }

    const { data } = result;
    const jsonContent = JSON.stringify(data, null, 2);
    const jsonBytes = Buffer.byteLength(jsonContent, 'utf8');

    if (jsonBytes > DISCORD_FILE_LIMIT) {
      // Too large for Discord — send summary + config-only file
      await sendLargeExportSummary(context, data, slug, jsonBytes);
    } else {
      // Send full export as attachment
      const attachment = new AttachmentBuilder(Buffer.from(jsonContent, 'utf8'), {
        name: `${slug}-export.json`,
        description: `Shapes.inc export for ${slug}`,
      });

      const embed = new EmbedBuilder()
        .setColor(DISCORD_COLORS.SUCCESS)
        .setTitle('📤 Export Complete')
        .setDescription(`Exported **${slug}** from shapes.inc.`)
        .addFields(
          { name: 'Memories', value: String(data.stats.memoriesCount), inline: true },
          { name: 'Stories', value: String(data.stats.storiesCount), inline: true },
          {
            name: 'User Personalization',
            value: data.stats.hasUserPersonalization ? 'Yes' : 'No',
            inline: true,
          }
        )
        .setTimestamp();

      await context.editReply({ embeds: [embed], files: [attachment] });
    }

    logger.info(
      {
        userId,
        slug,
        memoriesCount: data.stats.memoriesCount,
        storiesCount: data.stats.storiesCount,
        sizeBytes: jsonBytes,
      },
      '[Shapes] Export sent'
    );
  } catch (error) {
    logger.error({ err: error, userId, slug }, '[Shapes] Unexpected error exporting');
    await context.editReply({
      embeds: [],
      content: '❌ An unexpected error occurred. Please try again.',
    });
  }
}

interface ErrorResult {
  status: number;
  error: string;
}

function handleExportError(
  context: DeferredCommandContext,
  result: ErrorResult,
  slug: string
): Promise<void> {
  let message: string;

  if (result.status === 401) {
    message =
      '❌ No shapes.inc credentials found.\n\n' +
      'Use `/shapes auth` to store your session cookie first.';
  } else if (result.status === 404) {
    message = `❌ Shape **${slug}** not found on shapes.inc.`;
  } else {
    message = `❌ Export failed: ${result.error}`;
  }

  return context.editReply({ embeds: [], content: message }).then(() => undefined);
}

async function sendLargeExportSummary(
  context: DeferredCommandContext,
  data: ExportResponse,
  slug: string,
  totalBytes: number
): Promise<void> {
  // Send config-only (much smaller) as attachment
  const configOnly = {
    exportedAt: data.exportedAt,
    sourceSlug: data.sourceSlug,
    config: data.config,
    userPersonalization: data.userPersonalization,
    stats: data.stats,
    note: 'Full export exceeds Discord file limit. Config and personalization included; memories and stories omitted.',
  };

  const configJson = JSON.stringify(configOnly, null, 2);
  const attachment = new AttachmentBuilder(Buffer.from(configJson, 'utf8'), {
    name: `${slug}-config-export.json`,
    description: `Shapes.inc config export for ${slug} (memories omitted due to size)`,
  });

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.WARNING)
    .setTitle('📤 Partial Export')
    .setDescription(
      `Full export for **${slug}** is ${totalMB}MB (exceeds Discord's 8MB limit).\n\n` +
        'The attached file contains the **character config and personalization** only.\n' +
        'Use `/shapes import` to bring everything (including memories) directly into Tzurot.'
    )
    .addFields(
      { name: 'Memories', value: String(data.stats.memoriesCount), inline: true },
      { name: 'Stories', value: String(data.stats.storiesCount), inline: true }
    )
    .setTimestamp();

  await context.editReply({ embeds: [embed], files: [attachment] });
}
