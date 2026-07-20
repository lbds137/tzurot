/**
 * Shapes Status Formatters
 *
 * Shared formatting utilities for import/export job status display.
 * Used by both the /shapes status subcommand and the detail view.
 */

import {
  formatDiscordTimestamp,
  normalizeDateTime,
  normalizeDateTimeNullable,
} from '@tzurot/common-types/utils/dateFormatting';

export interface ImportJob {
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

export interface ExportJob {
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

/**
 * Adapt the Zod-validated import-job shape (which has
 * `createdAt: string | Date` etc. because Express's JSON serializer
 * stringifies Date but tests can pass Date directly) into the local
 * `ImportJob` type that downstream formatters consume.
 *
 * The `[key: string]: unknown` input + `as ImportJob` cast are deliberate:
 * the local `ImportJob` type narrows the date fields to `string`, but the
 * Zod-derived type (ShapesImportJobSummary) keeps them as `string | Date`.
 * The adapter is precisely the boundary that narrows them. Accepting the
 * Zod type directly would force every formatter to handle the union
 * everywhere downstream. The cost is that adding a new required non-date
 * field to ImportJob without updating callers won't surface here — the
 * regression would show up in formatter output instead.
 */
export function adaptImportJob(job: {
  createdAt: string | Date;
  completedAt: string | Date | null;
  [key: string]: unknown;
}): ImportJob {
  return {
    ...job,
    createdAt: normalizeDateTime(job.createdAt),
    completedAt: normalizeDateTimeNullable(job.completedAt),
  } as ImportJob;
}

export function adaptExportJob(job: {
  createdAt: string | Date;
  completedAt: string | Date | null;
  expiresAt: string | Date;
  [key: string]: unknown;
}): ExportJob {
  return {
    ...job,
    createdAt: normalizeDateTime(job.createdAt),
    completedAt: normalizeDateTimeNullable(job.completedAt),
    expiresAt: normalizeDateTime(job.expiresAt),
  } as ExportJob;
}

export const STATUS_EMOJI: Record<string, string> = {
  pending: '\uD83D\uDD50',
  in_progress: '\u23F3',
  completed: '\u2705',
  failed: '\u274C',
};

function formatProgressDetail(job: ImportJob): string {
  const progress = job.importMetadata?.progress;
  if (progress === undefined) {
    return '\n   Fetching data from shapes.inc...';
  }
  const pct = progress.total > 0 ? Math.round((progress.imported / progress.total) * 100) : 0;
  return `\n   Progress: ${progress.imported}/${progress.total} memories (${pct}%)`;
}

/** Truncate and format an error message for display */
function formatTruncatedError(errorMessage: string): string {
  const truncated = errorMessage.length > 80 ? `${errorMessage.slice(0, 80)}...` : errorMessage;
  return `\n   Error: ${truncated}`;
}

export function formatImportJobStatus(job: ImportJob): string {
  const emoji = STATUS_EMOJI[job.status] ?? '\u2753';
  const date = formatDiscordTimestamp(job.createdAt, 'D');
  let line = `${emoji} **${job.sourceSlug}** \u2014 ${job.status} (${date})`;

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
    line += formatTruncatedError(job.errorMessage);
  }

  return line;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatExportJobStatus(job: ExportJob): string {
  const emoji = STATUS_EMOJI[job.status] ?? '\u2753';
  const date = formatDiscordTimestamp(job.createdAt, 'D');
  let line = `${emoji} **${job.sourceSlug}** (${job.format}) \u2014 ${job.status} (${date})`;

  if (job.status === 'completed' && job.downloadUrl !== null) {
    const size = job.fileSizeBytes !== null ? ` (${formatFileSize(job.fileSizeBytes)})` : '';
    // <t:R> self-updates ("in 3 hours" \u2192 "in 2 hours") \u2014 no snapshot math.
    line += `\n   \uD83D\uDCE5 [Download${size}](${encodeURI(job.downloadUrl)})`;
    line += ` \u2014 expires ${formatDiscordTimestamp(job.expiresAt, 'R')}`;
  }

  if (job.status === 'failed' && job.errorMessage !== null) {
    line += formatTruncatedError(job.errorMessage);
  }

  return line;
}

/** Format compact progress detail for in-progress import */
function formatCompactProgress(job: ImportJob): string {
  const progress = job.importMetadata?.progress;
  if (progress === undefined) {
    return ' \u2014 fetching data...';
  }
  const pct = progress.total > 0 ? Math.round((progress.imported / progress.total) * 100) : 0;
  return ` \u2014 ${progress.imported}/${progress.total} (${pct}%)`;
}

/** Format a compact status line for the detail view (single job, no slug prefix) */
export function formatCompactImportStatus(job: ImportJob): string {
  const emoji = STATUS_EMOJI[job.status] ?? '\u2753';
  let line = `${emoji} ${job.status} (${job.importType})`;

  if (job.status === 'in_progress') {
    line += formatCompactProgress(job);
  }

  if (job.status === 'completed' && job.memoriesImported !== null) {
    line += ` \u2014 ${job.memoriesImported} memories imported`;
    if (job.memoriesFailed !== null && job.memoriesFailed > 0) {
      line += `, ${job.memoriesFailed} failed`;
    }
  }

  if (job.status === 'failed' && job.errorMessage !== null) {
    line += formatTruncatedError(job.errorMessage);
  }

  return line;
}

/** Format a compact status line for the detail view (single export job) */
export function formatCompactExportStatus(job: ExportJob): string {
  const emoji = STATUS_EMOJI[job.status] ?? '\u2753';
  let line = `${emoji} ${job.status} (${job.format})`;

  if (job.status === 'completed' && job.downloadUrl !== null) {
    const size = job.fileSizeBytes !== null ? ` (${formatFileSize(job.fileSizeBytes)})` : '';
    // <t:R> self-updates ("in 3 hours" \u2192 "in 2 hours") \u2014 no snapshot math.
    line += `\n   \uD83D\uDCE5 [Download${size}](${encodeURI(job.downloadUrl)}) \u2014 expires ${formatDiscordTimestamp(job.expiresAt, 'R')}`;
  }

  if (job.status === 'failed' && job.errorMessage !== null) {
    line += formatTruncatedError(job.errorMessage);
  }

  return line;
}
