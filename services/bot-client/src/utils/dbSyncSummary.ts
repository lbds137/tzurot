/**
 * Shared interpretation + summary rendering for db-sync responses.
 *
 * Two surfaces consume a sync response — the `/admin db-sync` slash command
 * (interactive, either mode) and the nightly scheduler (real sync, unattended)
 * — so the "did anything move?" predicate and the summary text live here
 * rather than in either consumer. The full report renderer is shared for the
 * same reason: the command stashes it behind its "Show details" button, and
 * the nightly scheduler attaches it to the owner-channel post.
 *
 * The summary's pointer at that report is a parameter, not a constant: each
 * caller states HOW it delivers the report (`ReportDelivery`) so the embed
 * never promises a surface that caller does not produce.
 *
 * The `SyncResult` view is deliberately lenient (every field optional) so the
 * render guards read naturally; the tightened `DbSyncResponse` is structurally
 * assignable to it, so consumers annotate rather than assert.
 */

import { escapeFenceBreaks } from './fenceEscape.js';

/** How the caller delivers the full report alongside the summary embed. */
export type ReportDelivery = 'below' | 'button' | 'attachment';

/**
 * The sentence tails that point at the report, per delivery. Deliberately a
 * lookup rather than a branch chain: adding a delivery mode is one row, and
 * the two pointers for a mode sit next to each other where they can't drift.
 */
const REPORT_POINTERS: Record<ReportDelivery, { warning: string; overflow: string }> = {
  below: {
    warning: 'full list in the report below',
    overflow: 'see the report below',
  },
  button: {
    warning: 'tap **Show details** for the full list',
    overflow: 'tap **Show details** for the full report',
  },
  attachment: {
    warning: 'full list in the attached report',
    overflow: 'see the attached report',
  },
};

export interface TableStats {
  devToProd?: number;
  prodToDev?: number;
  conflicts?: number;
  deleted?: number;
}

interface DeletionDetail {
  table: string;
  rowKey: string;
  target: 'dev' | 'prod';
}

export interface SyncResult {
  timestamp?: string;
  schemaVersion?: string;
  stats?: Record<string, TableStats>;
  warnings?: string[];
  info?: string[];
  deletions?: DeletionDetail[];
  deletionsTruncated?: boolean;
}

export function sumSyncCounters(stats: Record<string, TableStats>): Required<TableStats> {
  const totals = { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 };
  for (const s of Object.values(stats)) {
    totals.devToProd += s.devToProd ?? 0;
    totals.prodToDev += s.prodToDev ?? 0;
    totals.conflicts += s.conflicts ?? 0;
    totals.deleted += s.deleted ?? 0;
  }
  return totals;
}

function hasActivity(s: TableStats): boolean {
  return (
    (s.devToProd ?? 0) > 0 ||
    (s.prodToDev ?? 0) > 0 ||
    (s.conflicts ?? 0) > 0 ||
    (s.deleted ?? 0) > 0
  );
}

/**
 * True when any table moved, resolved, or deleted a row. Deliberately the
 * SAME condition that decides the summary's "No changes — databases already
 * in sync." line, so an unattended run stays silent exactly when the
 * interactive run would have rendered that line.
 */
export function hasSyncChanges(stats: Record<string, TableStats>): boolean {
  return Object.values(stats).some(hasActivity);
}

/** Embed-cap backstop: the active-table list is otherwise unbounded as the
 * synced-table set grows; the chunked follow-up report is the full surface. */
const ACTIVE_TABLE_LINES_MAX = 30;

/** One `table: N dev→prod, M prod→dev[, ...]` line per table with activity. */
function buildActiveTableLines(
  stats: Record<string, TableStats>,
  delivery: ReportDelivery
): string[] {
  const active = Object.entries(stats).filter(([, s]) => hasActivity(s));
  if (active.length === 0) {
    return ['', 'No changes — databases already in sync.'];
  }
  const lines = [''];
  for (const [table, s] of active.slice(0, ACTIVE_TABLE_LINES_MAX)) {
    const conflicts = (s.conflicts ?? 0) > 0 ? `, ${s.conflicts} conflicts` : '';
    const deleted = (s.deleted ?? 0) > 0 ? `, ${s.deleted} deleted` : '';
    lines.push(
      `\`${table}\`: ${s.devToProd ?? 0} dev→prod, ${s.prodToDev ?? 0} prod→dev${conflicts}${deleted}`
    );
  }
  if (active.length > ACTIVE_TABLE_LINES_MAX) {
    lines.push(
      `_…and ${active.length - ACTIVE_TABLE_LINES_MAX} more — ${REPORT_POINTERS[delivery].overflow}._`
    );
  }
  return lines;
}

/**
 * The tight embed description: totals line + tables with activity only.
 * Full per-table detail (including quiet tables) lives in the report the
 * caller delivers separately, so the embed can never outgrow Discord's
 * description cap — `delivery` is how the embed names that surface.
 */
export function buildSyncSummary(
  result: SyncResult,
  dryRun: boolean,
  delivery: ReportDelivery
): string {
  const lines: string[] = [];

  if (result.schemaVersion !== undefined && result.schemaVersion.length > 0) {
    lines.push(`**Schema Version**: \`${result.schemaVersion}\``);
  }

  const stats = result.stats ?? {};
  const tableCount = Object.keys(stats).length;
  if (tableCount > 0) {
    const totals = sumSyncCounters(stats);
    lines.push(
      '',
      `**${tableCount} tables** · ${totals.devToProd} dev→prod · ${totals.prodToDev} prod→dev · ${totals.conflicts} conflicts · ${totals.deleted} deleted`
    );
    lines.push(...buildActiveTableLines(stats, delivery));
  }

  const warningCount = result.warnings?.length ?? 0;
  if (warningCount > 0) {
    lines.push('', `⚠️ ${warningCount} warning(s) — ${REPORT_POINTERS[delivery].warning}`);
  }
  if (dryRun) {
    lines.push('', '*Dry run — no changes were applied.*');
  }

  return lines.join('\n');
}

/** The `## Per-table stats` section — every table, active or not. Fixed-width
 * rows in a code fence: Discord doesn't render markdown pipe-tables, and the
 * fence keeps columns aligned on mobile (same solve as /inspect's memory
 * inspector). */
function buildStatsSection(stats: Record<string, TableStats>): string[] {
  const entries = Object.entries(stats);
  const lines = ['', '## Per-table stats', ''];
  if (entries.length === 0) {
    lines.push('_No table stats returned._');
    return lines;
  }
  const tableWidth = Math.max(5, ...entries.map(([table]) => table.length));
  lines.push('```');
  lines.push(`${'Table'.padEnd(tableWidth)} dev→prod prod→dev conflicts deleted`);
  for (const [table, s] of entries) {
    lines.push(
      `${table.padEnd(tableWidth)} ${String(s.devToProd ?? 0).padStart(8)} ${String(s.prodToDev ?? 0).padStart(8)} ${String(s.conflicts ?? 0).padStart(9)} ${String(s.deleted ?? 0).padStart(7)}`
    );
  }
  lines.push('```');
  return lines;
}

/** The row-level deletions section, with dry-run framing and cap notes. */
function buildDeletionsSection(result: SyncResult, dryRun: boolean): string[] {
  const deletions = result.deletions ?? [];
  const heading = dryRun ? 'Deletions that would propagate' : 'Deletions queued for propagation';
  const capped = result.deletionsTruncated === true;
  const lines = ['', `## ${heading} (${deletions.length}${capped ? '+' : ''})`, ''];
  if (deletions.length === 0) {
    lines.push('None.');
    return lines;
  }
  for (const d of deletions) {
    // rowKeys are UUID surrogates today; the escape neutralizes 3+ backtick
    // runs (fence opens / splitMessage mis-pairing). A future free-text pk
    // with SINGLE backticks could still end the inline-code span early —
    // cosmetic only, revisit if a non-UUID pk ever joins SYNC_CONFIG.
    lines.push(`- \`${d.table}\` · \`${escapeFenceBreaks(d.rowKey)}\` → ${d.target}`);
  }
  if (capped) {
    lines.push(
      '',
      '_Row detail capped by the gateway; the per-table Deleted counts above are complete._'
    );
  }
  if (!dryRun) {
    lines.push(
      '',
      '_Rows listed were queued; the per-table Deleted counts reflect what actually executed (a propagation warning explains any gap)._'
    );
  }
  return lines;
}

/** A counted `## <title> (N)` bullet-list section; explicit `None.` when empty. */
function buildListSection(title: string, items: string[]): string[] {
  const lines = ['', `## ${title} (${items.length})`, ''];
  if (items.length === 0) {
    lines.push('None.');
    return lines;
  }
  for (const item of items) {
    // Warnings/info carry table names and row detail — content-derived text
    lines.push(`- ${escapeFenceBreaks(item)}`);
  }
  return lines;
}

/**
 * The full untruncated report: every table's stats row, row-level deletion
 * detail, and the complete warnings/info lists. The slash command delivers it
 * behind its "Show details" button (or inline when the stash is unavailable);
 * the nightly scheduler attaches it as a file.
 */
export function buildSyncReportText(result: SyncResult, dryRun: boolean): string {
  const lines: string[] = [`# Database Sync Report${dryRun ? ' (dry run)' : ''}`, ''];

  lines.push(`- Run: ${result.timestamp ?? new Date().toISOString()}`);
  lines.push(`- Mode: ${dryRun ? 'DRY RUN — no changes applied' : 'LIVE'}`);
  if (result.schemaVersion !== undefined && result.schemaVersion.length > 0) {
    lines.push(`- Schema version: ${result.schemaVersion}`);
  }

  lines.push(...buildStatsSection(result.stats ?? {}));
  lines.push(...buildDeletionsSection(result, dryRun));
  lines.push(...buildListSection('Warnings', result.warnings ?? []));
  lines.push(...buildListSection('Info', result.info ?? []));

  lines.push('');
  return lines.join('\n');
}
