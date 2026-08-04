/**
 * Tests for the shared db-sync response interpretation + summary rendering.
 *
 * The `buildSyncSummary` cases moved here verbatim when the renderer was
 * extracted from the `/admin db-sync` handler so the nightly scheduler could
 * share it; `hasSyncChanges` / `sumSyncCounters` are the scheduler-facing
 * additions.
 */

import { describe, it, expect } from 'vitest';
import { buildSyncSummary, hasSyncChanges, sumSyncCounters } from './dbSyncSummary.js';

describe('buildSyncSummary — embed backstop', () => {
  it('caps the active-table list at 30 lines with a see-report tail', () => {
    const stats = Object.fromEntries(
      Array.from({ length: 35 }, (_, i) => [
        `table_${i}`,
        { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 },
      ])
    );
    const summary = buildSyncSummary({ stats }, false);

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
      false
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
      false
    );

    expect(summary).toContain('`users`: 1 dev→prod, 0 prod→dev, 2 conflicts, 3 deleted');
    expect(summary).toContain('`personas`: 4 dev→prod, 0 prod→dev');
    expect(summary).not.toContain('`personas`: 4 dev→prod, 0 prod→dev,');
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
    expect(buildSyncSummary({ stats: quiet }, false)).toContain('No changes');
    expect(hasSyncChanges(busy)).toBe(true);
    expect(buildSyncSummary({ stats: busy }, false)).not.toContain('No changes');
  });
});
