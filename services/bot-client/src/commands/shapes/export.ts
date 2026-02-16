/**
 * Shapes Export Subcommand
 *
 * Fetches full character data from shapes.inc and returns it as
 * a downloadable file attachment in Discord (JSON or Markdown).
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

interface ShapesMemory {
  result: string;
  senders: string[];
  metadata: { created_at: number };
}

interface ShapesStory {
  title: string;
  content: string;
  story_type: string;
}

interface ExportResponse {
  exportedAt: string;
  sourceSlug: string;
  config: Record<string, unknown>;
  memories: ShapesMemory[];
  stories: ShapesStory[];
  userPersonalization: Record<string, unknown> | null;
  stats: {
    memoriesCount: number;
    storiesCount: number;
    hasUserPersonalization: boolean;
  };
}

type ExportFormat = 'json' | 'markdown';

// ============================================================================
// Markdown formatter
// ============================================================================

/** Key personality config fields to include in markdown export */
const PERSONALITY_FIELDS: readonly { key: string; label: string }[] = [
  { key: 'personality_traits', label: 'Personality Traits' },
  { key: 'personality_tone', label: 'Tone' },
  { key: 'personality_age', label: 'Age' },
  { key: 'personality_appearance', label: 'Appearance' },
  { key: 'personality_likes', label: 'Likes' },
  { key: 'personality_dislikes', label: 'Dislikes' },
  { key: 'personality_conversational_goals', label: 'Conversational Goals' },
  { key: 'personality_conversational_examples', label: 'Conversational Examples' },
  { key: 'personality_history', label: 'History' },
] as const;

/** Extract a string field from the untyped config Record */
function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatConfigSection(config: Record<string, unknown>, sourceSlug: string): string[] {
  const lines: string[] = [];
  const name = configString(config, 'name') ?? sourceSlug;
  lines.push(`# ${name}`, '');

  const jailbreak = configString(config, 'jailbreak');
  if (jailbreak !== undefined) {
    lines.push('## System Prompt', '', jailbreak, '');
  }

  const userPrompt = configString(config, 'user_prompt');
  if (userPrompt !== undefined) {
    lines.push('## Character Info', '', userPrompt, '');
  }

  const personalityLines = PERSONALITY_FIELDS.map(({ key, label }) => ({
    label,
    value: configString(config, key),
  }))
    .filter((f): f is { label: string; value: string } => f.value !== undefined)
    .map(({ label, value }) => `### ${label}\n\n${value}`);

  if (personalityLines.length > 0) {
    lines.push('## Personality', '', personalityLines.join('\n\n'), '');
  }

  return lines;
}

function formatMemoriesSection(memories: ShapesMemory[]): string[] {
  if (memories.length === 0) {
    return [];
  }

  const lines = ['## Memories', '', `*${String(memories.length)} conversation memories*`, ''];
  for (const memory of memories) {
    const date = new Date(memory.metadata.created_at * 1000).toISOString().split('T')[0];
    const senders = memory.senders.length > 0 ? ` (${memory.senders.join(', ')})` : '';
    lines.push(`- **${date}**${senders}: ${memory.result}`);
  }
  lines.push('');
  return lines;
}

function formatStoriesSection(stories: ShapesStory[]): string[] {
  if (stories.length === 0) {
    return [];
  }

  const lines = ['## Knowledge Base', ''];
  for (const story of stories) {
    const title = story.title !== '' ? story.title : `(${story.story_type})`;
    lines.push(`### ${title}`, '', story.content, '');
  }
  return lines;
}

function formatExportAsMarkdown(data: ExportResponse): string {
  const lines: string[] = [];

  lines.push(`> Exported from shapes.inc on ${data.exportedAt}`, '');
  lines.push(...formatConfigSection(data.config, data.sourceSlug));

  // User personalization
  const backstory =
    data.userPersonalization !== null
      ? configString(data.userPersonalization, 'backstory')
      : undefined;
  if (backstory !== undefined) {
    lines.push('## User Personalization', '', backstory, '');
  }

  lines.push(...formatStoriesSection(data.stories));
  lines.push(...formatMemoriesSection(data.memories));

  // Stats footer
  lines.push(
    '---',
    '',
    `Memories: ${String(data.stats.memoriesCount)} | ` +
      `Stories: ${String(data.stats.storiesCount)} | ` +
      `User Personalization: ${data.stats.hasUserPersonalization ? 'Yes' : 'No'}`
  );

  return lines.join('\n');
}

/**
 * Handle /shapes export <slug> subcommand
 * Fetches data from shapes.inc and sends as Discord file attachment
 */
export async function handleExport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const slug = context.interaction.options.getString('slug', true).trim().toLowerCase();
  const formatRaw = context.interaction.options.getString('format') ?? 'json';
  const format: ExportFormat = formatRaw === 'markdown' ? 'markdown' : 'json';

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

    const { content: fileContent, filename } =
      format === 'markdown'
        ? { content: formatExportAsMarkdown(data), filename: `${slug}-export.md` }
        : { content: JSON.stringify(data, null, 2), filename: `${slug}-export.json` };

    const fileBytes = Buffer.byteLength(fileContent, 'utf8');

    if (fileBytes > DISCORD_FILE_LIMIT) {
      await sendLargeExportSummary(context, data, slug, fileBytes);
    } else {
      const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf8'), {
        name: filename,
        description: `Shapes.inc export for ${slug}`,
      });

      const embed = new EmbedBuilder()
        .setColor(DISCORD_COLORS.SUCCESS)
        .setTitle('📤 Export Complete')
        .setDescription(`Exported **${slug}** from shapes.inc as ${format.toUpperCase()}.`)
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
        format,
        memoriesCount: data.stats.memoriesCount,
        storiesCount: data.stats.storiesCount,
        sizeBytes: fileBytes,
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
