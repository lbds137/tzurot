/**
 * Unit tests for the pure helpers of the reroll attempt module: metadata
 * merging and the abort tombstone list. The lock and the abort transaction are
 * pinned against real rows in `historyReroll.component.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/conversation-history', () => ({ propagateDeletionToFacts: vi.fn() }));

import {
  committedRowMetadata,
  isTombstoned,
  metadataRecord,
  storedIncognito,
  storedIncognitoKind,
  nextTombstones,
} from './rerollAttempt.js';

describe('metadata reads', () => {
  it('treats absent, array and non-object metadata as empty', () => {
    expect(metadataRecord(null)).toEqual({});
    expect(metadataRecord([1])).toEqual({});
    expect(metadataRecord('x')).toEqual({});
  });

  it('reads the stored flag only when it is exactly true', () => {
    expect(storedIncognito({ messageMetadata: { incognito: true } })).toBe(true);
    expect(storedIncognito({ messageMetadata: { incognito: false } })).toBe(false);
    expect(storedIncognito({ messageMetadata: {} })).toBe(false);
  });

  it('reads a recognised kind and ignores anything else', () => {
    expect(storedIncognitoKind({ messageMetadata: { incognitoKind: 'session' } })).toBe('session');
    expect(storedIncognitoKind({ messageMetadata: { incognitoKind: 'bogus' } })).toBeUndefined();
    expect(storedIncognitoKind({ messageMetadata: null })).toBeUndefined();
  });
});

describe('committedRowMetadata', () => {
  it('always carries an explicit incognito boolean', () => {
    expect(committedRowMetadata({}, false, undefined)).toEqual({ incognito: false });
    expect(committedRowMetadata(null, true, undefined)).toEqual({ incognito: true });
  });

  it('keeps other keys, drops the old tombstones and the old kind', () => {
    expect(
      committedRowMetadata(
        { custom: 1, abortedRerollAttempts: ['a'], incognito: true, incognitoKind: 'session' },
        false,
        'summon'
      )
    ).toEqual({ custom: 1, incognito: false });
  });

  it('writes the kind only beside incognito: true', () => {
    expect(committedRowMetadata({}, true, 'summon')).toEqual({
      incognito: true,
      incognitoKind: 'summon',
    });
  });
});

describe('abort tombstones', () => {
  it('appends an attempt id once', () => {
    const once = nextTombstones({ incognito: true }, 'a1');
    const twice = nextTombstones({ abortedRerollAttempts: once }, 'a1');

    expect(once).toEqual(['a1']);
    expect(twice).toEqual(['a1']);
    expect(isTombstoned({ abortedRerollAttempts: twice }, 'a1')).toBe(true);
    expect(isTombstoned({ abortedRerollAttempts: twice }, 'a2')).toBe(false);
  });

  it('keeps only the newest 10', () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) {
      list = nextTombstones({ abortedRerollAttempts: list }, `a${i}`);
    }

    expect(list).toHaveLength(10);
    expect(list[0]).toBe('a2');
    expect(list.at(-1)).toBe('a11');
  });

  it('is not tombstoned when metadata has no list or a malformed one', () => {
    expect(isTombstoned(null, 'a')).toBe(false);
    expect(isTombstoned({ abortedRerollAttempts: 'a' }, 'a')).toBe(false);
  });
});
