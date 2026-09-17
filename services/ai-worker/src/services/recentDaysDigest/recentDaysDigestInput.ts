/**
 * Recent-days digest: pure input-window builder.
 *
 * Turns the sweep's newest-first row read into the chronological, place-labelled
 * lines the prompt frames, applying the two source caps (row count, then
 * token count) by dropping the OLDEST rows first — the newest conversation is
 * always what the digest is about.
 *
 * Deliberately takes ONLY the source rows: there is no parameter through which
 * a pair's PRIOR digest text can enter, so a prior digest can never leak into
 * a regeneration's source window even if the caller has one in hand (D10 e).
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { formatAbsoluteTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';

/** One source row, as the sweep reads it (newest-first) from `conversation_history`. */
export interface DigestSourceRow {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  channelId: string;
  guildId: string | null;
}

export interface BuildDigestInputOptions {
  rows: DigestSourceRow[];
  tz: string;
  names: { personaLabel: string; characterLabel: string };
  caps?: { maxMessages: number; maxTokens: number };
}

export interface DigestInputWindow {
  lines: string[];
  windowStart: Date;
  sourceWatermark: Date;
  sourceRowIds: string[];
  sourceRowCount: number;
  truncated: boolean;
}

/** Assign `server channel <A|B|C...>` labels in order of first appearance
 *  while scanning chronologically (oldest to newest) — the order the model
 *  actually reads the rows in, not the order they arrived from the DB. */
function assignChannelLetters(rowsChronological: DigestSourceRow[]): Map<string, string> {
  const letters = new Map<string, string>();
  for (const row of rowsChronological) {
    if (row.guildId === null || letters.has(row.channelId)) {
      continue;
    }
    // 65 = 'A'. Past 26 distinct guild channels in one generation the code
    // point runs on into punctuation and lowercase, not a second-letter
    // scheme — the label would degrade, not wrap. The window caps make that
    // unreachable in practice, so it is accepted rather than built around.
    letters.set(row.channelId, String.fromCharCode(65 + letters.size));
  }
  return letters;
}

function placeLabel(row: DigestSourceRow, letters: Map<string, string>): string {
  if (row.guildId === null) {
    return 'DMs';
  }
  return `server channel ${letters.get(row.channelId) ?? '?'}`;
}

/** Drop the newest-first rows down to `maxMessages`, then drop further
 *  OLDEST-first (from what remains) until the summed content token count is
 *  at or under `maxTokens`. Returns the survivors, still newest-first. */
function applyCaps(
  rows: DigestSourceRow[],
  caps: { maxMessages: number; maxTokens: number }
): DigestSourceRow[] {
  const byCount = rows.slice(0, caps.maxMessages);
  let total = byCount.reduce((sum, row) => sum + countTextTokens(row.content), 0);
  const kept = [...byCount];
  // Trim from the tail of a newest-first array — i.e. drop the OLDEST
  // survivor first — until the running total fits. Never drops below one
  // row: a pair is only ever selected with >=1 window row, and a single
  // newest row over the token cap is better sent as-is than dropped to
  // nothing.
  while (total > caps.maxTokens && kept.length > 1) {
    const dropped = kept.pop();
    if (dropped === undefined) {
      break;
    }
    total -= countTextTokens(dropped.content);
  }
  return kept;
}

/** Build one pair's digest input window from its source rows. */
export function buildDigestInput(options: BuildDigestInputOptions): DigestInputWindow {
  const { rows, tz, names } = options;
  const caps = options.caps ?? {
    maxMessages: RECENT_DAYS_DIGEST.MAX_SOURCE_MESSAGES,
    maxTokens: RECENT_DAYS_DIGEST.MAX_SOURCE_TOKENS,
  };

  const kept = applyCaps(rows, caps);
  const truncated = kept.length < rows.length;

  // Chronological for both the letter assignment and the emitted lines.
  const chronological = [...kept].reverse();
  const letters = assignChannelLetters(chronological);

  const lines = chronological.map(row => {
    const speaker =
      row.role === (MessageRole.Assistant as string) ? names.characterLabel : names.personaLabel;
    const timestamp = formatAbsoluteTimestamp(row.createdAt, tz);
    return `[${timestamp}] [${placeLabel(row, letters)}] ${speaker}: ${row.content}`;
  });

  const oldest = chronological[0];
  const newest = chronological[chronological.length - 1];
  // Not expected in practice: selection requires >=1 window row, but the sweep
  // re-reads the window afterwards, so a purge that empties it in between
  // reaches here. The throw is caught by the sweep's per-pair catch and counted
  // as a zero-spend failure; that read-time race has no test of its own.
  if (oldest === undefined || newest === undefined) {
    throw new Error('buildDigestInput called with no source rows');
  }

  return {
    lines,
    windowStart: oldest.createdAt,
    sourceWatermark: newest.createdAt,
    sourceRowIds: kept.map(row => row.id),
    sourceRowCount: kept.length,
    truncated,
  };
}
