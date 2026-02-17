/**
 * Shapes Status Subcommand
 *
 * Shows credential status, import history, and export history for shapes.inc.
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';

const logger = createLogger('shapes-status');

interface AuthStatusResponse {
  hasCredentials: boolean;
  service: string;
  storedAt?: string;
  lastUsedAt?: string;
}

interface ImportJob {
  id: string;
  sourceSlug: string;
  status: string;
  importType: string;
  memoriesImported: number | null;
  memoriesFailed: number | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  importMetadata: {
    progress?: { imported: number; failed: number; total: number };
  } | null;
}

interface ExportJob {
  id: string;
  sourceSlug: string;
  status: string;
  format: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  errorMessage: string | null;
  downloadUrl: string | null;
}

interface ImportJobsResponse {
  jobs: ImportJob[];
}

interface ExportJobsResponse {
  jobs: ExportJob[];
}

const STATUS_EMOJI: Record<string, string> = {
  pending: '🕐',
  in_progress: '⏳',
  completed: '✅',
  failed: '❌',
};

function formatProgressDetail(job: ImportJob): string {
  const progress = job.importMetadata?.progress;
  if (progress === undefined) {
    return '\n   Fetching data from shapes.inc...';
  }
  const pct = progress.total > 0 ? Math.round((progress.imported / progress.total) * 100) : 0;
  return `\n   Progress: ${progress.imported}/${progress.total} memories (${pct}%)`;
}

function formatImportJobStatus(job: ImportJob): string {
  const emoji = STATUS_EMOJI[job.status] ?? '❓';
  const date = new Date(job.createdAt).toLocaleDateString();
  let line = `${emoji} **${job.sourceSlug}** — ${job.status} (${date})`;

  if (job.status === 'in_progress') {
    line += formatProgressDetail(job);
  }

  if (job.status === 'completed' && job.memoriesImported !== null) {
    line += `\n   Memories: ${job.memoriesImported} imported`;
    if (job.memoriesFailed !== null && job.memoriesFailed > 0) {
      line += `, ${job.memoriesFailed} failed`;
    }
  }

  if (job.status === 'failed' && job.errorMessage !== null) {
    const truncated =
      job.errorMessage.length > 80 ? `${job.errorMessage.slice(0, 80)}...` : job.errorMessage;
    line += `\n   Error: ${truncated}`;
  }

  return line;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatExportJobStatus(job: ExportJob): string {
  const emoji = STATUS_EMOJI[job.status] ?? '❓';
  const date = new Date(job.createdAt).toLocaleDateString();
  let line = `${emoji} **${job.sourceSlug}** (${job.format}) — ${job.status} (${date})`;

  if (job.status === 'completed' && job.downloadUrl !== null) {
    const size = job.fileSizeBytes !== null ? ` (${formatFileSize(job.fileSizeBytes)})` : '';
    const expiresAt = new Date(job.expiresAt);
    const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3600000));
    line += `\n   📥 [Download${size}](${job.downloadUrl})`;
    line += ` — expires in ${hoursLeft}h`;
  }

  if (job.status === 'failed' && job.errorMessage !== null) {
    const truncated =
      job.errorMessage.length > 80 ? `${job.errorMessage.slice(0, 80)}...` : job.errorMessage;
    line += `\n   Error: ${truncated}`;
  }

  return line;
}

/**
 * Handle /shapes status subcommand
 * Shows credential status, import history, and export history
 */
export async function handleStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    // Fetch auth status, import history, and export history in parallel
    const [authResult, importJobsResult, exportJobsResult] = await Promise.all([
      callGatewayApi<AuthStatusResponse>('/user/shapes/auth/status', {
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }),
      callGatewayApi<ImportJobsResponse>('/user/shapes/import/jobs', {
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }),
      callGatewayApi<ExportJobsResponse>('/user/shapes/export/jobs', {
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }),
    ]);

    const hasCredentials = authResult.ok && authResult.data.hasCredentials;

    const embed = new EmbedBuilder()
      .setColor(hasCredentials ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.WARNING)
      .setTitle('🔗 Shapes.inc Status')
      .setTimestamp();

    // Credential status
    const credentialStatus = hasCredentials
      ? '✅ Authenticated — credentials stored securely'
      : '❌ Not authenticated — use `/shapes auth` to connect';
    embed.addFields({ name: 'Credentials', value: credentialStatus });

    // Import history
    if (importJobsResult.ok && importJobsResult.data.jobs.length > 0) {
      const jobLines = importJobsResult.data.jobs.slice(0, 5).map(formatImportJobStatus);
      embed.addFields({
        name: `Import History (${importJobsResult.data.jobs.length})`,
        value: jobLines.join('\n\n'),
      });
    } else {
      embed.addFields({
        name: 'Import History',
        value: 'No imports yet. Use `/shapes import <slug>` to get started.',
      });
    }

    // Export history
    if (exportJobsResult.ok && exportJobsResult.data.jobs.length > 0) {
      const jobLines = exportJobsResult.data.jobs.slice(0, 5).map(formatExportJobStatus);
      embed.addFields({
        name: `Export History (${exportJobsResult.data.jobs.length})`,
        value: jobLines.join('\n\n'),
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.debug({ userId, hasCredentials }, '[Shapes] Status displayed');
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Unexpected error fetching status');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
