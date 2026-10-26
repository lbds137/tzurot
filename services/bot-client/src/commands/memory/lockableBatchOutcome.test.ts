/**
 * Tests for the shared lockable-item batch outcome helpers (memory facts + memories).
 */

import { describe, it, expect } from 'vitest';
import { GatewayClientError } from '@tzurot/clients';
import {
  ALREADY_GONE_NOTE,
  type BatchItemResult,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import {
  buildSkippedLockableLine,
  countLockableBatchLines,
  formatLockableCountsLine,
  resolveMissingLockableLabels,
  toLockableResultLine,
  type LockableBatchCounts,
  type LockableBatchNouns,
  type LockableLabelCollectors,
  type ResolvedLockableLabel,
} from './lockableBatchOutcome.js';

const FACT_NOUNS = {
  noun: 'fact',
  destroyVerb: 'forget',
} satisfies LockableBatchNouns;

const MEMORY_NOUNS = {
  noun: 'memory',
  destroyVerb: 'delete',
} satisfies LockableBatchNouns;

function make403Error(error = 'Cannot delete a locked item'): GatewayClientError {
  return new GatewayClientError({
    ok: false,
    status: 403,
    error,
    kind: 'http',
  });
}

describe('toLockableResultLine', () => {
  it('maps a 403 GatewayClientError on a destroy run to a locked line ("locked — unlock first")', () => {
    const failed403 = {
      id: 'item-1',
      ok: false,
      error: make403Error(),
    } satisfies BatchItemResult<'success' | 'already-gone'>;

    expect(
      toLockableResultLine(failed403, 'Alpha', { destroying: true, nouns: FACT_NOUNS })
    ).toEqual({
      label: 'Alpha',
      status: 'locked',
      note: 'locked — unlock first',
    });
    expect(
      toLockableResultLine(failed403, 'Beta', { destroying: true, nouns: MEMORY_NOUNS })
    ).toEqual({
      label: 'Beta',
      status: 'locked',
      note: 'locked — unlock first',
    });
  });

  it('maps a 403 GatewayClientError on a lock run to a failed line, not locked', () => {
    const failed403 = {
      id: 'item-1',
      ok: false,
      error: make403Error('Forbidden'),
    } satisfies BatchItemResult<'success' | 'already-gone'>;

    const line = toLockableResultLine(failed403, 'Alpha', {
      destroying: false,
      nouns: MEMORY_NOUNS,
    });
    expect(line.status).toBe('failed');
    expect(line.label).toBe('Alpha');
    expect(line.note).toContain('Forbidden');
    expect(line.note).not.toBe('locked — unlock first');
  });

  it('renders non-403 failures with the destroy failedAction when destroying is true and the lock noun when false', () => {
    const unknownFailure = {
      id: 'item-2',
      ok: false,
      error: new Error('unrecognized failure'),
    } satisfies BatchItemResult<'success' | 'already-gone'>;

    const factDestroyLine = toLockableResultLine(unknownFailure, 'Fact A', {
      destroying: true,
      nouns: FACT_NOUNS,
    });
    expect(factDestroyLine.status).toBe('failed');
    expect(factDestroyLine.note).toContain('Failed to forget the fact.');

    const memoryDestroyLine = toLockableResultLine(unknownFailure, 'Mem A', {
      destroying: true,
      nouns: MEMORY_NOUNS,
    });
    expect(memoryDestroyLine.status).toBe('failed');
    expect(memoryDestroyLine.note).toContain('Failed to delete the memory.');

    const factLockLine = toLockableResultLine(unknownFailure, 'Fact A', {
      destroying: false,
      nouns: FACT_NOUNS,
    });
    expect(factLockLine.status).toBe('failed');
    expect(factLockLine.note).toContain('Failed to update fact lock.');

    const memoryLockLine = toLockableResultLine(unknownFailure, 'Mem A', {
      destroying: false,
      nouns: MEMORY_NOUNS,
    });
    expect(memoryLockLine.status).toBe('failed');
    expect(memoryLockLine.note).toContain('Failed to update memory lock.');
  });

  it('maps a resolved success value to a note-less success line', () => {
    const okSuccess = {
      id: 'item-3',
      ok: true,
      value: 'success',
    } satisfies BatchItemResult<'success' | 'already-gone'>;

    expect(
      toLockableResultLine(okSuccess, 'Alpha', { destroying: true, nouns: FACT_NOUNS })
    ).toEqual({
      label: 'Alpha',
      status: 'success',
    });
  });

  it('maps a resolved already-gone value to a gone line with ALREADY_GONE_NOTE', () => {
    const okGone = {
      id: 'item-4',
      ok: true,
      value: 'already-gone',
    } satisfies BatchItemResult<'success' | 'already-gone'>;

    expect(
      toLockableResultLine(okGone, 'Alpha', { destroying: false, nouns: MEMORY_NOUNS })
    ).toEqual({
      label: 'Alpha',
      status: 'gone',
      note: ALREADY_GONE_NOTE,
    });
  });
});

describe('buildSkippedLockableLine', () => {
  const skips = {
    goneIds: new Set(['gone-1']),
    lockedIds: new Set(['locked-1']),
    readErrors: new Map<string, unknown>([['unreadable-1', new Error('boom')]]),
  };

  it('renders a gone-set id as gone with ALREADY_GONE_NOTE on both destroy and lock runs', () => {
    expect(
      buildSkippedLockableLine('gone-1', 'Gone Item', skips, {
        destroying: true,
        nouns: FACT_NOUNS,
      })
    ).toEqual({
      label: 'Gone Item',
      status: 'gone',
      note: ALREADY_GONE_NOTE,
    });
    expect(
      buildSkippedLockableLine('gone-1', 'Gone Item', skips, {
        destroying: false,
        nouns: MEMORY_NOUNS,
      })
    ).toEqual({
      label: 'Gone Item',
      status: 'gone',
      note: ALREADY_GONE_NOTE,
    });
  });

  it('renders a locked-set id as "locked — unlock first" on a destroy run and "already locked" on a lock run', () => {
    expect(
      buildSkippedLockableLine('locked-1', 'Locked Item', skips, {
        destroying: true,
        nouns: FACT_NOUNS,
      })
    ).toEqual({
      label: 'Locked Item',
      status: 'locked',
      note: 'locked — unlock first',
    });
    expect(
      buildSkippedLockableLine('locked-1', 'Locked Item', skips, {
        destroying: false,
        nouns: FACT_NOUNS,
      })
    ).toEqual({
      label: 'Locked Item',
      status: 'locked',
      note: 'already locked',
    });
  });

  it('renders a remaining skipped id as a read-classified failed line naming the noun', () => {
    const factFailed = buildSkippedLockableLine('unreadable-1', 'Fact ID: unread…', skips, {
      destroying: false,
      nouns: FACT_NOUNS,
    });
    expect(factFailed.status).toBe('failed');
    expect(factFailed.label).toBe('Fact ID: unread…');
    expect(factFailed.note).toContain('Failed to load the fact.');

    const memoryFailed = buildSkippedLockableLine('unreadable-1', 'Memory ID: unread…', skips, {
      destroying: false,
      nouns: MEMORY_NOUNS,
    });
    expect(memoryFailed.status).toBe('failed');
    expect(memoryFailed.note).toContain('Failed to load the memory.');
  });
});

interface FakeLockableItem {
  id: string;
  text: string;
  isLocked: boolean;
}

function makeCollectors(): LockableLabelCollectors {
  return {
    resolved: new Map<string, ResolvedLockableLabel>(),
    readErrors: new Map<string, unknown>(),
    goneIds: new Set<string>(),
  } satisfies LockableLabelCollectors;
}

const formatFakeLabel = (item: FakeLockableItem): string => item.text;
const formatFakeFallback = (id: string): string => `Item ID: ${id}…`;

describe('resolveMissingLockableLabels', () => {
  it('records a 404 (null read) in goneIds and resolved with the fallback label and isLocked: null', async () => {
    const collectors = makeCollectors();

    await resolveMissingLockableLabels<FakeLockableItem>(
      ['item-1'],
      {
        read: () => Promise.resolve(null),
        toLabel: formatFakeLabel,
        fallbackLabel: formatFakeFallback,
      },
      collectors
    );

    expect([...collectors.goneIds]).toEqual(['item-1']);
    expect(collectors.resolved.get('item-1')).toEqual({
      label: 'Item ID: item-1…',
      isLocked: null,
    } satisfies ResolvedLockableLabel);
    expect(collectors.readErrors.size).toBe(0);
  });

  it('records a resolved item with its formatted label and lock state without marking it gone', async () => {
    const collectors = makeCollectors();
    const items = new Map<string, FakeLockableItem>([
      ['item-1', { id: 'item-1', text: 'First item', isLocked: false }],
      ['item-2', { id: 'item-2', text: 'Second item', isLocked: true }],
    ]);

    await resolveMissingLockableLabels<FakeLockableItem>(
      ['item-1', 'item-2'],
      {
        read: id => Promise.resolve(items.get(id) ?? null),
        toLabel: formatFakeLabel,
        fallbackLabel: formatFakeFallback,
      },
      collectors
    );

    expect(collectors.resolved.get('item-1')).toEqual({
      label: 'First item',
      isLocked: false,
    } satisfies ResolvedLockableLabel);
    expect(collectors.resolved.get('item-2')).toEqual({
      label: 'Second item',
      isLocked: true,
    } satisfies ResolvedLockableLabel);
    expect(collectors.goneIds.size).toBe(0);
    expect(collectors.readErrors.size).toBe(0);
  });

  it('records a thrown read in readErrors and leaves resolved untouched for that id', async () => {
    const collectors = makeCollectors();
    const boom = new Error('gateway read failed');

    await resolveMissingLockableLabels<FakeLockableItem>(
      ['item-1'],
      {
        read: () => Promise.reject(boom),
        toLabel: formatFakeLabel,
        fallbackLabel: formatFakeFallback,
      },
      collectors
    );

    expect(collectors.readErrors.get('item-1')).toBe(boom);
    expect(collectors.resolved.size).toBe(0);
    expect(collectors.goneIds.size).toBe(0);
  });

  it('runs reads for every id even when one throws', async () => {
    const collectors = makeCollectors();
    const boom = new Error('transient failure');
    const seen: string[] = [];

    await resolveMissingLockableLabels<FakeLockableItem>(
      ['item-throw', 'item-ok', 'item-gone'],
      {
        read: id => {
          seen.push(id);
          if (id === 'item-throw') {
            return Promise.reject(boom);
          }
          if (id === 'item-ok') {
            return Promise.resolve({ id, text: 'Resolved after throw', isLocked: true });
          }
          return Promise.resolve(null);
        },
        toLabel: formatFakeLabel,
        fallbackLabel: formatFakeFallback,
      },
      collectors
    );

    expect(seen).toEqual(['item-throw', 'item-ok', 'item-gone']);
    expect(collectors.readErrors.get('item-throw')).toBe(boom);
    expect(collectors.resolved.has('item-throw')).toBe(false);
    expect(collectors.resolved.get('item-ok')).toEqual({
      label: 'Resolved after throw',
      isLocked: true,
    } satisfies ResolvedLockableLabel);
    expect(collectors.goneIds.has('item-gone')).toBe(true);
    expect(collectors.resolved.get('item-gone')).toEqual({
      label: 'Item ID: item-gone…',
      isLocked: null,
    } satisfies ResolvedLockableLabel);
  });
});

describe('countLockableBatchLines', () => {
  it('tallies succeeded, gone, failed, and locked lines into their separate buckets', () => {
    const lines = [
      { label: 'a', status: 'success' },
      { label: 'b', status: 'success' },
      { label: 'c', status: 'gone', note: ALREADY_GONE_NOTE },
      { label: 'd', status: 'locked', note: 'already locked' },
      { label: 'e', status: 'locked', note: 'locked — unlock first' },
      { label: 'f', status: 'locked', note: 'locked — unlock first' },
      { label: 'g', status: 'failed', note: 'boom' },
    ] satisfies BatchResultLine[];

    expect(countLockableBatchLines(lines)).toEqual({
      succeeded: 2,
      gone: 1,
      failed: 1,
      locked: 3,
    } satisfies LockableBatchCounts);
  });
});

describe('formatLockableCountsLine', () => {
  const counts = {
    succeeded: 3,
    gone: 1,
    locked: 2,
    failed: 4,
  } satisfies LockableBatchCounts;

  it('renders "locked (skipped)" on a destroy run and "already locked" on a lock run', () => {
    expect(formatLockableCountsLine(counts, true)).toBe(
      'Batch finished: 3 succeeded, 1 already gone, 2 locked (skipped), 4 failed.'
    );
    expect(formatLockableCountsLine(counts, false)).toBe(
      'Batch finished: 3 succeeded, 1 already gone, 2 already locked, 4 failed.'
    );
  });
});
