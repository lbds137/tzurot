import { describe, it, expect } from 'vitest';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { countEntriesBeforeHead } from './historyWindowTelemetry.js';

describe('countEntriesBeforeHead', () => {
  const msg = (id: string): ConversationMessage => ({ id }) as ConversationMessage;

  it('counts the entries the merge put ahead of the window head', () => {
    const history = [msg('ext-1'), msg('ext-2'), msg('head'), msg('tail')];
    expect(countEntriesBeforeHead(history, 'head')).toBe(2);
  });

  it('is 0 when the head leads the merged history', () => {
    expect(countEntriesBeforeHead([msg('head'), msg('tail')], 'head')).toBe(0);
  });

  it('never goes negative when the merge DROPS rows and prepends nothing', () => {
    // The regression this replaced: `history.length - dbHistory.length` nets
    // dedup drops against extended additions, so a user @-pinging two
    // personalities (two rows, one Discord id, one collapsed) reported -1.
    // Locating the head cannot express that shape at all.
    expect(countEntriesBeforeHead([msg('head'), msg('tail')], 'head')).toBe(0);
    expect(countEntriesBeforeHead([msg('head')], 'head')).toBe(0);
  });

  it('is null — not 0 — when the head is absent from the merged history', () => {
    // A dropped head is a different fact from an unprepended one; flattening
    // them to 0 would hide the merge losing a row it should have kept.
    expect(countEntriesBeforeHead([msg('a'), msg('b')], 'head')).toBeNull();
  });

  it('is null for an empty window', () => {
    expect(countEntriesBeforeHead([], null)).toBeNull();
    expect(countEntriesBeforeHead([msg('a')], null)).toBeNull();
  });
});
