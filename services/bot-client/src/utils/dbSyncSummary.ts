/**
 * Shared interpretation + summary rendering for db-sync responses.
 *
 * Two surfaces consume a sync response — the `/admin db-sync` slash command
 * (interactive, either mode) and the nightly scheduler (real sync, unattended)
 * — so the "did anything move?" predicate and the summary text live here
 * rather than in either consumer. The full report renderer stays with the
 * command: it exists to back the command's own "Show details" button.
 *
 * The `SyncResult` view is deliberately lenient (every field optional) so the
 * render guards read naturally; the tightened `DbSyncResponse` is structurally
 * assignable to it, so consumers annotate rather than assert.
 */

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
function buildActiveTableLines(stats: Record<string, TableStats>): string[] {
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
    lines.push(`_…and ${active.length - ACTIVE_TABLE_LINES_MAX} more — see the report below._`);
  }
  return lines;
}

/**
 * The tight embed description: totals line + tables with activity only.
 * Full per-table detail (including quiet tables) lives in the chunked
 * follow-up report, so the embed can never outgrow Discord's description cap.
 */
export function buildSyncSummary(result: SyncResult, dryRun: boolean): string {
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
    lines.push(...buildActiveTableLines(stats));
  }

  const warningCount = result.warnings?.length ?? 0;
  if (warningCount > 0) {
    lines.push('', `⚠️ ${warningCount} warning(s) — full list in the report below`);
  }
  if (dryRun) {
    lines.push('', '*Dry run — no changes were applied.*');
  }

  return lines.join('\n');
}
