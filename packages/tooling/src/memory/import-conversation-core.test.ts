import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_IMPORT_SOURCE_SYSTEM,
  EXTRAS_QUERY_LIMIT,
  buildExpectedRows,
  compareVerifyRows,
  formatImportedMemoryContent,
  formatVerifyLines,
  importedMemoryId,
  pairTurns,
  parseConversationTurns,
  type ActualRow,
  type ConversationTurn,
  type ImportPair,
} from './import-conversation-core.js';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { UsageError } from '../utils/errors.js';

const MARKER = 'SECRET-MARKER-7f3a';
const PERSONA = '11111111-1111-4111-8111-111111111111';
const PERSONALITY = '22222222-2222-4222-8222-222222222222';

function turn(role: 'user' | 'assistant', text: string, timestamp: string): ConversationTurn {
  return { role, text, timestamp };
}

/** Two alternating pairs at distinct prompt times; assistant ts differs on purpose. */
function twoPairs(): ConversationTurn[] {
  return [
    turn('user', 'u0', '2025-05-17T04:33:38.686Z'),
    turn('assistant', 'a0', '2025-05-17T04:33:39.001Z'),
    turn('user', 'u1', '2025-05-17T04:40:00.123Z'),
    turn('assistant', 'a1', '2025-05-17T04:40:00.123Z'),
  ];
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return (error as Error).message;
  }
  throw new Error('expected a throw');
}

describe('parseConversationTurns', () => {
  it('accepts a valid array', () => {
    expect(parseConversationTurns(twoPairs())).toHaveLength(4);
  });

  it('refuses a non-array', () => {
    expect(() => parseConversationTurns({ role: 'user' })).toThrow(UsageError);
  });

  it('names the turn index and field for a bad role, without leaking text', () => {
    const raw = [
      ...twoPairs(),
      { role: 'system', text: MARKER, timestamp: '2025-05-17T05:00:00Z' },
    ];
    const message = messageOf(() => parseConversationTurns(raw));
    expect(message).toContain('turn 4');
    expect(message).toContain("'role'");
    expect(message).not.toContain(MARKER);
  });

  it('names the turn index and field for a bad timestamp, without leaking text', () => {
    const raw = [{ role: 'user', text: MARKER, timestamp: 'not-a-date' }];
    const message = messageOf(() => parseConversationTurns(raw));
    expect(message).toContain('turn 0');
    expect(message).toContain("'timestamp'");
    expect(message).not.toContain(MARKER);
  });

  it('names the field for a non-string text without leaking the value', () => {
    const raw = [{ role: 'user', text: { nested: MARKER }, timestamp: '2025-05-17T05:00:00Z' }];
    const message = messageOf(() => parseConversationTurns(raw));
    expect(message).toContain("'text'");
    expect(message).not.toContain(MARKER);
  });

  it('refuses a non-object turn by index', () => {
    expect(messageOf(() => parseConversationTurns(['x']))).toContain('turn 0');
  });
});

describe('pairTurns', () => {
  it('pairs by prompt timestamp to the ms, ignoring the assistant timestamp', () => {
    const pairs = pairTurns(twoPairs());
    expect(pairs).toHaveLength(2);
    expect(pairs[0].index).toBe(0);
    expect(pairs[1].index).toBe(1);
    expect(pairs[0].promptAt.toISOString()).toBe('2025-05-17T04:33:38.686Z');
    expect(pairs[0].userText).toBe('u0');
    expect(pairs[0].assistantText).toBe('a0');
  });

  it('refuses an empty file', () => {
    expect(() => pairTurns([])).toThrow(UsageError);
  });

  it('refuses when the first turn is an assistant, naming turn 0', () => {
    const turns = [turn('assistant', MARKER, '2025-05-17T04:00:00Z'), ...twoPairs()];
    const message = messageOf(() => pairTurns(turns));
    expect(message).toContain('turn 0');
    expect(message).not.toContain(MARKER);
  });

  it('refuses two users in a row, naming the second', () => {
    const turns = [
      turn('user', MARKER, '2025-05-17T04:00:00Z'),
      turn('user', MARKER, '2025-05-17T04:01:00Z'),
    ];
    const message = messageOf(() => pairTurns(turns));
    expect(message).toContain('turn 1: expected role assistant');
    expect(message).not.toContain(MARKER);
  });

  it('refuses two assistants in a row, naming the second', () => {
    const turns = [...twoPairs(), turn('assistant', MARKER, '2025-05-17T05:00:00Z')];
    expect(messageOf(() => pairTurns(turns))).toContain('turn 4');
  });

  it('refuses a trailing user turn', () => {
    const turns = [...twoPairs(), turn('user', MARKER, '2025-05-17T05:00:00Z')];
    const message = messageOf(() => pairTurns(turns));
    expect(message).toContain('turn 4');
    expect(message).not.toContain(MARKER);
  });

  it('refuses non-ascending prompt timestamps, naming the later turn', () => {
    const turns = twoPairs();
    turns[2] = turn('user', 'u1', '2025-05-17T04:00:00.000Z');
    expect(messageOf(() => pairTurns(turns))).toContain('turn 2');
  });

  it('refuses equal prompt timestamps', () => {
    const turns = twoPairs();
    turns[2] = turn('user', 'u1', '2025-05-17T04:33:38.686Z');
    expect(messageOf(() => pairTurns(turns))).toContain('turn 2');
  });

  describe('template collisions', () => {
    const collisions: [string, string, string][] = [
      ['user text containing the assistant separator', `a\n{assistant}: ${MARKER}`, 'fine'],
      ['assistant text containing the assistant separator', 'fine', `a\n{assistant}: ${MARKER}`],
      [
        'assistant text ending in a referenced-content block',
        'fine',
        `a\n\n[Referenced content: ${MARKER}]`,
      ],
    ];

    it.each(collisions)(
      'refuses %s, naming the turn index only',
      (_name, userText, assistantText) => {
        const turns = [
          ...twoPairs(),
          turn('user', userText, '2025-05-17T05:00:00Z'),
          turn('assistant', assistantText, '2025-05-17T05:00:01Z'),
        ];
        const message = messageOf(() => pairTurns(turns));
        expect(message).toContain('turn 4');
        expect(message).toContain('text collides with the stored memory template');
        expect(message).not.toContain(MARKER);
      }
    );

    it('accepts benign multi-line text', () => {
      const turns = [
        turn('user', 'line one\nline two\n\nline four', '2025-05-17T04:00:00Z'),
        turn('assistant', '{assistant} mentioned inline\nsecond line', '2025-05-17T04:00:01Z'),
      ];
      expect(pairTurns(turns)).toHaveLength(1);
    });
  });
});

describe('formatImportedMemoryContent', () => {
  it('round-trips through the read-side splitMemoryContent', () => {
    const userMessage = 'hello\nwith a second line';
    const aiResponse = 'hi there';

    const split = splitMemoryContent(formatImportedMemoryContent(userMessage, aiResponse));

    expect(split).toEqual({ user: userMessage, assistant: aiResponse, referenced: null });
  });
});

describe('importedMemoryId', () => {
  const pair = (index: number, at: string): ImportPair => ({
    index,
    promptAt: new Date(at),
    userText: 'same',
    assistantText: 'same',
  });

  it('is deterministic', () => {
    const p = pair(3, '2025-05-17T04:33:38.686Z');
    expect(importedMemoryId(PERSONA, PERSONALITY, p)).toBe(
      importedMemoryId(PERSONA, PERSONALITY, p)
    );
  });

  it('differs by index even with identical texts and timestamps', () => {
    const a = importedMemoryId(PERSONA, PERSONALITY, pair(0, '2025-05-17T04:33:38.686Z'));
    const b = importedMemoryId(PERSONA, PERSONALITY, pair(1, '2025-05-17T04:33:38.686Z'));
    expect(a).not.toBe(b);
  });

  it('differs across personas and personalities', () => {
    const p = pair(0, '2025-05-17T04:33:38.686Z');
    const base = importedMemoryId(PERSONA, PERSONALITY, p);
    expect(importedMemoryId('33333333-3333-4333-8333-333333333333', PERSONALITY, p)).not.toBe(base);
    expect(importedMemoryId(PERSONA, '44444444-4444-4444-8444-444444444444', p)).not.toBe(base);
  });

  it('exports the tag used for rows', () => {
    expect(EXTERNAL_IMPORT_SOURCE_SYSTEM).toBe('external-import');
  });
});

describe('compareVerifyRows', () => {
  const expected = buildExpectedRows(pairTurns(twoPairs()), PERSONA, PERSONALITY);
  const target = { personalityId: PERSONALITY, personaId: PERSONA };

  // Built from the raw turns, independently of the module's formatter and
  // pairing, so a template or prompt-timestamp regression reddens (b)/(c).
  function actualRows(): ActualRow[] {
    const turns = twoPairs();
    return expected.map((row, i) => ({
      id: row.id,
      content: `{user}: ${turns[2 * i].text}\n{assistant}: ${turns[2 * i + 1].text}`,
      created_at: new Date(turns[2 * i].timestamp),
      personality_id: PERSONALITY,
      persona_id: PERSONA,
    }));
  }

  function run(actual: ActualRow[], extraTaggedIds: string[] = []) {
    return compareVerifyRows({ expected, actual, extraTaggedIds, target });
  }

  it('passes everything on an exact match', () => {
    const checks = run(actualRows());
    expect(checks.every(c => c.pass)).toBe(true);
    expect(formatVerifyLines(checks)[0]).toBe('PASS (a) count: 2/2 rows, 0 extra');
  });

  it('fails count for a missing row and names its index, once', () => {
    const rows = actualRows().slice(1);
    const checks = run(rows);
    expect(checks[0].pass).toBe(false);
    expect(checks[0].mismatchIndexes).toEqual([0]);
    expect(checks[1].pass).toBe(true);
    expect(checks[2].pass).toBe(true);
    expect(checks[3].pass).toBe(true);
  });

  it('fails count for an extra tagged row', () => {
    const checks = run(actualRows(), ['55555555-5555-4555-8555-555555555555']);
    expect(checks[0].pass).toBe(false);
    expect(checks[0].detail).toContain('1 extra');
  });

  it('reports a lower bound when the extras query returned a full page', () => {
    const full = Array.from(
      { length: EXTRAS_QUERY_LIMIT },
      () => '55555555-5555-4555-8555-555555555555'
    );
    const checks = run(actualRows(), full);
    expect(checks[0].pass).toBe(false);
    expect(checks[0].detail).toContain(`${EXTRAS_QUERY_LIMIT}+ extra`);
  });

  it('fails content on a one-byte drift and names the index', () => {
    const rows = actualRows();
    rows[1].content = `${rows[1].content}.`;
    const checks = run(rows);
    expect(checks[1].pass).toBe(false);
    expect(checks[1].mismatchIndexes).toEqual([1]);
    expect(formatVerifyLines(checks)[1]).toBe('FAIL (b) content: mismatching pair indexes 1');
  });

  it('fails createdAt when off by 1 ms', () => {
    const rows = actualRows();
    rows[0].created_at = new Date(rows[0].created_at.getTime() + 1);
    const checks = run(rows);
    expect(checks[2].pass).toBe(false);
    expect(checks[2].mismatchIndexes).toEqual([0]);
  });

  it('fails target when the persona differs', () => {
    const rows = actualRows();
    rows[1].persona_id = '66666666-6666-4666-8666-666666666666';
    const checks = run(rows);
    expect(checks[3].pass).toBe(false);
    expect(checks[3].mismatchIndexes).toEqual([1]);
  });

  it('does not pass b/c/d vacuously when nothing was found', () => {
    const checks = run([]);
    expect(checks[0].pass).toBe(false);
    for (const check of checks.slice(1)) {
      expect(check.pass).toBe(false);
      expect(check.detail).toBe('no rows to check');
    }
  });

  it('never puts row content in the formatted lines', () => {
    const rows = actualRows();
    rows[0].content = MARKER;
    const lines = formatVerifyLines(run(rows)).join('\n');
    expect(lines).not.toContain(MARKER);
  });
});
