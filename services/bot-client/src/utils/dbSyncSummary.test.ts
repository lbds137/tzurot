/**
 * Tests for the shared db-sync response interpretation + summary rendering.
 *
 * The `buildSyncSummary` and `buildSyncReportText` cases moved here verbatim
 * when those renderers were extracted from the `/admin db-sync` handler so the
 * nightly scheduler could share them; `hasSyncChanges` / `sumSyncCounters` are
 * the scheduler-facing additions.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSyncReportText,
  buildSyncSummary,
  hasSyncChanges,
  sumSyncCounters,
  type ReportDelivery,
} from './dbSyncSummary.js';

describe('buildSyncSummary — embed backstop', () => {
  it('caps the active-table list at 30 lines with a see-report tail', () => {
    const stats = Object.fromEntries(
      Array.from({ length: 35 }, (_, i) => [
        `table_${i}`,
        { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 },
      ])
    );
    const summary = buildSyncSummary({ stats }, false, 'below');

    expect(summary).toContain('`table_0`:');
    expect(summary).toContain('`table_29`:');
    expect(summary).not.toContain('`table_30`:');
    expect(summary).toContain('…and 5 more — see the report below.');
  });
});

describe('buildSyncSummary', () => {
  it('reports the in-sync state when no table has activity', () => {
    const summary = buildSyncSummary(
      {
        schemaVersion: 'v1',
        stats: { users: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 } },
      },
      false,
      'below'
    );

    expect(summary).toContain('No changes — databases already in sync.');
  });

  it('appends conflict and deleted suffixes only when nonzero', () => {
    const summary = buildSyncSummary(
      {
        stats: {
          users: { devToProd: 1, prodToDev: 0, conflicts: 2, deleted: 3 },
          personas: { devToProd: 4, prodToDev: 0, conflicts: 0, deleted: 0 },
        },
      },
      false,
      'below'
    );

    expect(summary).toContain('`users`: 1 dev→prod, 0 prod→dev, 2 conflicts, 3 deleted');
    expect(summary).toContain('`personas`: 4 dev→prod, 0 prod→dev');
    expect(summary).not.toContain('`personas`: 4 dev→prod, 0 prod→dev,');
  });
});

describe('buildSyncSummary — report-delivery promise', () => {
  /** 35 active tables: past the 30-line cap, so the overflow tail renders. */
  const overflowStats = Object.fromEntries(
    Array.from({ length: 35 }, (_, i) => [
      `table_${i}`,
      { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 },
    ])
  );

  it.each([
    ['below', '⚠️ 2 warning(s) — full list in the report below'],
    ['button', '⚠️ 2 warning(s) — tap **Show details** for the full list'],
    ['attachment', '⚠️ 2 warning(s) — full list in the attached report'],
  ])('points the warning line at the %s delivery', (delivery, expected) => {
    const summary = buildSyncSummary(
      { warnings: ['first', 'second'] },
      false,
      delivery as ReportDelivery
    );

    expect(summary).toContain(expected);
  });

  it.each([
    ['below', '_…and 5 more — see the report below._'],
    ['button', '_…and 5 more — tap **Show details** for the full report._'],
    ['attachment', '_…and 5 more — see the attached report._'],
  ])('points the overflow line at the %s delivery', (delivery, expected) => {
    const summary = buildSyncSummary({ stats: overflowStats }, false, delivery as ReportDelivery);

    expect(summary).toContain(expected);
  });
});

describe('sumSyncCounters', () => {
  it('adds every counter across tables, defaulting missing ones to zero', () => {
    expect(
      sumSyncCounters({
        users: { devToProd: 1, prodToDev: 2, conflicts: 3, deleted: 4 },
        personas: { devToProd: 10 },
      })
    ).toEqual({ devToProd: 11, prodToDev: 2, conflicts: 3, deleted: 4 });
  });

  it('returns all zeros for an empty stats map', () => {
    expect(sumSyncCounters({})).toEqual({
      devToProd: 0,
      prodToDev: 0,
      conflicts: 0,
      deleted: 0,
    });
  });
});

describe('hasSyncChanges', () => {
  it('is false for an empty stats map', () => {
    expect(hasSyncChanges({})).toBe(false);
  });

  it('is false when every counter on every table is zero', () => {
    expect(
      hasSyncChanges({
        users: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 },
        personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 },
      })
    ).toBe(false);
  });

  it.each([
    ['devToProd', { devToProd: 1 }],
    ['prodToDev', { prodToDev: 1 }],
    ['conflicts', { conflicts: 1 }],
    ['deleted', { deleted: 1 }],
  ])('is true when only %s moved', (_label, stats) => {
    expect(hasSyncChanges({ users: stats })).toBe(true);
  });

  it('agrees with the summary renderer: false exactly when it prints the in-sync line', () => {
    const quiet = { users: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 } };
    const busy = { users: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 2 } };

    expect(hasSyncChanges(quiet)).toBe(false);
    expect(buildSyncSummary({ stats: quiet }, false, 'below')).toContain('No changes');
    expect(hasSyncChanges(busy)).toBe(true);
    expect(buildSyncSummary({ stats: busy }, false, 'below')).not.toContain('No changes');
  });
});

describe('buildSyncReportText', () => {
  const baseResult = {
    timestamp: '2026-07-11T00:00:00.000Z',
    schemaVersion: '20260710230428_add_sync_tombstones',
    stats: {
      users: { devToProd: 3, prodToDev: 1, conflicts: 0, deleted: 0 },
      personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 2 },
    },
    warnings: ['personas: 2 conflicts resolved using last-write-wins'],
    info: ["Table 'audit_log' excluded: local-only audit trail"],
    deletions: [
      { table: 'personas', rowKey: 'aaaa-1111', target: 'prod' as const },
      { table: 'personas', rowKey: 'bbbb-2222', target: 'dev' as const },
    ],
    deletionsTruncated: false,
  };

  it('includes EVERY table in the stats table, active or not', () => {
    const report = buildSyncReportText(baseResult, false);

    // Fixed-width rows in a code fence (Discord renders no pipe-tables)
    expect(report).toContain('```');
    expect(report).toMatch(/^users\s+3\s+1\s+0\s+0$/m);
    expect(report).toMatch(/^personas\s+0\s+0\s+0\s+2$/m);
  });

  it('lists each deletion row with its losing side', () => {
    const report = buildSyncReportText(baseResult, false);

    expect(report).toContain('## Deletions queued for propagation (2)');
    expect(report).toContain('- `personas` · `aaaa-1111` → prod');
    expect(report).toContain('- `personas` · `bbbb-2222` → dev');
  });

  it('uses would-propagate framing under dry run', () => {
    const report = buildSyncReportText(baseResult, true);

    expect(report).toContain('# Database Sync Report (dry run)');
    expect(report).toContain('- Mode: DRY RUN — no changes applied');
    expect(report).toContain('## Deletions that would propagate (2)');
  });

  it('marks a gateway-capped deletion list loudly', () => {
    const report = buildSyncReportText({ ...baseResult, deletionsTruncated: true }, false);

    expect(report).toContain('## Deletions queued for propagation (2+)');
    expect(report).toContain('Row detail capped by the gateway');
  });

  it('carries full warnings and info without truncation', () => {
    const manyWarnings = Array.from({ length: 60 }, (_, i) => `warning line ${i}`);
    const report = buildSyncReportText({ ...baseResult, warnings: manyWarnings }, false);

    expect(report).toContain('## Warnings (60)');
    expect(report).toContain('- warning line 0');
    expect(report).toContain('- warning line 59');
    expect(report).toContain("- Table 'audit_log' excluded: local-only audit trail");
  });

  it('neutralizes triple-backticks in warnings (content-derived text)', () => {
    const report = buildSyncReportText(
      { ...baseResult, warnings: ['table dump contained ```sql DROP``` fragment'] },
      false
    );

    // Raw fences: exactly the stats table's own pair — the warning's run is neutralized
    expect(report.match(/```/g)).toHaveLength(2);
    expect(report.replace(/\u200b/g, '')).toContain('```sql DROP```');
  });

  it('renders explicit None sections for an empty result', () => {
    const report = buildSyncReportText({}, false);

    expect(report).toContain('_No table stats returned._');
    expect(report).toContain('## Deletions queued for propagation (0)');
    expect(report).toContain('## Warnings (0)');
    expect(report).toContain('None.');
  });
});
