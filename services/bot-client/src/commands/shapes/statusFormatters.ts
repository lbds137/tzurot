/**
 * Shapes Status Formatters
 *
 * Shared formatting utilities for import/export job status display.
 * Used by both the /shapes status subcommand and the detail view.
 */

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

export interface ImportJobsResponse {
  jobs: ImportJob[];
}

export interface ExportJobsResponse {
  jobs: ExportJob[];
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
  const date = new Date(job.createdAt).toLocaleDateString();
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
  const date = new Date(job.createdAt).toLocaleDateString();
  let line = `${emoji} **${job.sourceSlug}** (${job.format}) \u2014 ${job.status} (${date})`;

  if (job.status === 'completed' && job.downloadUrl !== null) {
    const size = job.fileSizeBytes !== null ? ` (${formatFileSize(job.fileSizeBytes)})` : '';
    const expiresAt = new Date(job.expiresAt);
    const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3600000));
    line += `\n   \uD83D\uDCE5 [Download${size}](${encodeURI(job.downloadUrl)})`;
    line += ` \u2014 expires in ${hoursLeft}h`;
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
    const expiresAt = new Date(job.expiresAt);
    const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3600000));
    line += `\n   \uD83D\uDCE5 [Download${size}](${encodeURI(job.downloadUrl)}) \u2014 expires in ${hoursLeft}h`;
  }

  if (job.status === 'failed' && job.errorMessage !== null) {
    line += formatTruncatedError(job.errorMessage);
  }

  return line;
}
