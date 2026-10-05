/**
 * Conversation import — pure logic (no DB, no IO).
 *
 * Turns an exported two-party conversation (a JSON array of
 * `{ role, text, timestamp }`) into memory rows shaped like the ones the live
 * path writes. Every refusal and every report line here names a turn INDEX or
 * a count, never any turn text: the input is private conversation content and
 * must not reach a terminal or a log.
 */

import { z } from 'zod';
import { deterministicMemoryUuid } from '@tzurot/common-types/constants/memory';
import { UsageError } from '../utils/errors.js';

/** `memories.source_system` tag for rows written by this command (VarChar(50)). */
export const EXTERNAL_IMPORT_SOURCE_SYSTEM = 'external-import';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface ImportPair {
  /** Zero-based index of the pair (the user turn's position / 2). */
  index: number;
  /** The user (prompt) turn's timestamp; becomes the memory's created_at. */
  promptAt: Date;
  userText: string;
  assistantText: string;
}

export interface ExpectedRow {
  index: number;
  id: string;
  content: string;
  createdAt: Date;
}

export interface ActualRow {
  id: string;
  content: string;
  created_at: Date;
  personality_id: string;
  persona_id: string;
}

export interface VerifyInput {
  expected: ExpectedRow[];
  actual: ActualRow[];
  /** Tagged rows for this personality+persona whose id is not in the expected set. */
  extraTaggedIds: string[];
  target: { personalityId: string; personaId: string };
}

export interface VerifyCheck {
  name: string;
  pass: boolean;
  detail: string;
  mismatchIndexes: number[];
}

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  timestamp: z.string().refine(value => !Number.isNaN(new Date(value).getTime())),
});

/**
 * Validate the raw parsed JSON. Messages are built from the issue path only:
 * zod's own messages can echo the offending value, which is conversation text.
 */
export function parseConversationTurns(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) {
    throw new UsageError('Input must be a JSON array of { role, text, timestamp } turns');
  }
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = TurnSchema.safeParse(raw[i]);
    if (!result.success) {
      const field = result.error.issues[0]?.path[0];
      const where = typeof field === 'string' ? `field '${field}'` : 'the turn object';
      throw new UsageError(`turn ${i}: invalid ${where}`);
    }
    turns.push(result.data);
  }
  return turns;
}

/**
 * Pair strictly alternating user→assistant turns. Anything else is refused
 * rather than guessed at, since a silent skip would shift every later pair.
 */
export function pairTurns(turns: ConversationTurn[]): ImportPair[] {
  if (turns.length === 0) {
    throw new UsageError('Input has no turns');
  }
  const pairs: ImportPair[] = [];
  for (let i = 0; i < turns.length; i += 2) {
    const user = turns[i];
    const assistant = turns[i + 1];
    if (user.role !== 'user') {
      throw new UsageError(`turn ${i}: expected role user, got ${user.role}`);
    }
    if (assistant === undefined) {
      throw new UsageError(`turn ${i}: user turn has no assistant reply (trailing user turn)`);
    }
    if (assistant.role !== 'assistant') {
      throw new UsageError(`turn ${i + 1}: expected role assistant, got ${assistant.role}`);
    }
    const promptAt = new Date(user.timestamp);
    const previous = pairs[pairs.length - 1];
    if (previous !== undefined && promptAt.getTime() <= previous.promptAt.getTime()) {
      throw new UsageError(`turn ${i}: prompt timestamp is not after turn ${i - 2}`);
    }
    pairs.push({
      index: i / 2,
      promptAt,
      userText: user.text,
      assistantText: assistant.text,
    });
  }
  return pairs;
}

/**
 * Same template the live path writes (`LongTermMemoryService` and the LTM
 * backfill); pinned by a test, not shared, because the services don't import
 * from tooling.
 */
export function formatImportedMemoryContent(userText: string, assistantText: string): string {
  return `{user}: ${userText}\n{assistant}: ${assistantText}`;
}

/**
 * Deterministic id from the pair's identity (tag, index, prompt time) rather
 * than its content, so two identical exchanges at different points of the
 * conversation stay distinct memories while a re-run maps to the same ids.
 */
export function importedMemoryId(
  personaId: string,
  personalityId: string,
  pair: ImportPair
): string {
  const seed = `${EXTERNAL_IMPORT_SOURCE_SYSTEM}:${pair.index}:${pair.promptAt.toISOString()}`;
  return deterministicMemoryUuid(personaId, personalityId, seed);
}

export function buildExpectedRows(
  pairs: ImportPair[],
  personaId: string,
  personalityId: string
): ExpectedRow[] {
  return pairs.map(pair => ({
    index: pair.index,
    id: importedMemoryId(personaId, personalityId, pair),
    content: formatImportedMemoryContent(pair.userText, pair.assistantText),
    createdAt: pair.promptAt,
  }));
}

function indexList(indexes: number[]): string {
  return indexes.join(', ');
}

/** Build a per-field check over the rows that were found. */
function fieldCheck(
  name: string,
  found: { row: ExpectedRow; actual: ActualRow }[],
  expectedCount: number,
  matches: (row: ExpectedRow, actual: ActualRow) => boolean
): VerifyCheck {
  if (found.length === 0 && expectedCount > 0) {
    return { name, pass: false, detail: 'no rows to check', mismatchIndexes: [] };
  }
  const mismatchIndexes = found.filter(f => !matches(f.row, f.actual)).map(f => f.row.index);
  return {
    name,
    pass: mismatchIndexes.length === 0,
    detail:
      mismatchIndexes.length === 0
        ? `${found.length}/${found.length} rows match`
        : `mismatching pair indexes ${indexList(mismatchIndexes)}`,
    mismatchIndexes,
  };
}

/** Pure comparison behind `--verify`: four independent checks (count, content, createdAt, target). */
export function compareVerifyRows(input: VerifyInput): VerifyCheck[] {
  const { expected, actual, extraTaggedIds, target } = input;
  const byId = new Map(actual.map(row => [row.id, row]));
  const found: { row: ExpectedRow; actual: ActualRow }[] = [];
  const missing: number[] = [];
  for (const row of expected) {
    const hit = byId.get(row.id);
    if (hit === undefined) {
      missing.push(row.index);
    } else {
      found.push({ row, actual: hit });
    }
  }

  const countPass = missing.length === 0 && extraTaggedIds.length === 0;
  const countDetail =
    `${found.length}/${expected.length} rows, ${extraTaggedIds.length} extra` +
    (missing.length > 0 ? `, missing pair indexes ${indexList(missing)}` : '');

  return [
    { name: 'count', pass: countPass, detail: countDetail, mismatchIndexes: missing },
    fieldCheck('content', found, expected.length, (e, a) => a.content === e.content),
    fieldCheck(
      'createdAt',
      found,
      expected.length,
      (e, a) => a.created_at.getTime() === e.createdAt.getTime()
    ),
    fieldCheck(
      'target',
      found,
      expected.length,
      (_e, a) => a.personality_id === target.personalityId && a.persona_id === target.personaId
    ),
  ];
}

const CHECK_LETTERS = ['a', 'b', 'c', 'd'];

/** Render checks as `PASS (a) count: ...` lines. Indexes and counts only. */
export function formatVerifyLines(checks: VerifyCheck[]): string[] {
  return checks.map(
    (check, i) =>
      `${check.pass ? 'PASS' : 'FAIL'} (${CHECK_LETTERS[i] ?? String(i)}) ${check.name}: ${check.detail}`
  );
}
