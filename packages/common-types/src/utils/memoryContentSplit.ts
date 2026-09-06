/**
 * Splits a stored memory's `content` back into its `{user}`/`{assistant}`
 * template parts, and strips `> `-prefixed quote lines from a user turn.
 * Shared by the memory-archive render-pilot tooling and the ai-worker
 * memory-archive split render (docs/proposals/backlog/memory-archive-format.md).
 */

/** One memory's stored content, split back into its template parts. */
export interface SplitMemoryResult {
  user: string;
  assistant: string;
  referenced: string | null;
}

// The stored template is `{user}: <userMessage>\n{assistant}: <aiResponse>`
// (LongTermMemoryService.ts). A live masked probe over a sampled corpus found
// the `[Referenced content: ...]` marker inside the USER part, at its end, in
// every sampled row that carried one — i.e. the stored shape is
// `{user}: <userMessage>\n\n[Referenced content: <text>]\n{assistant}: <aiResponse>`.
// This matches the code path: MemoryPersistenceService's
// `buildContentForEmbedding` appends the block to `contentForStorage` and
// that combined string is passed as `userMessage` into
// LongTermMemoryService's template interpolation, i.e. the block is baked
// into the user segment before the template is applied. The older
// end-of-whole-content shape (`]` as the last character of the entire
// content) is also still recognised, in case it occurs elsewhere.
export const REFERENCED_BLOCK_RE = /\n\n\[Referenced content: ([\s\S]*)\]$/;
export const USER_PREFIX = '{user}: ';
export const ASSISTANT_SEPARATOR = '\n{assistant}: ';

/**
 * Split a stored memory's `content` back into user text, assistant text, and
 * an optional referenced-content block. Returns `null` when the content does
 * not match the stored template, OR when the separator appears more than
 * once (ambiguous split point) — the caller counts these as `unparseable`
 * and excludes the row.
 */
export function splitMemoryContent(content: string): SplitMemoryResult | null {
  let remainder = content;
  let referenced: string | null = null;

  const refMatch = REFERENCED_BLOCK_RE.exec(remainder);
  if (refMatch !== null) {
    referenced = refMatch[1];
    remainder = remainder.slice(0, refMatch.index);
  }

  if (!remainder.startsWith(USER_PREFIX)) {
    return null;
  }
  const separatorIndex = remainder.indexOf(ASSISTANT_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }
  // The stored template contains exactly one `\n{assistant}: ` separator, so
  // a second occurrence means the content is ambiguous (typically a user
  // message quoting the template) — the row is excluded as `unparseable`
  // rather than mis-split at an arbitrary boundary.
  if (remainder.includes(ASSISTANT_SEPARATOR, separatorIndex + ASSISTANT_SEPARATOR.length)) {
    return null;
  }

  let user = remainder.slice(USER_PREFIX.length, separatorIndex);
  const assistant = remainder.slice(separatorIndex + ASSISTANT_SEPARATOR.length);

  // The referenced block more commonly sits at the end of the USER part
  // rather than the end of the whole content (see comment above). Check the
  // user part for the same anchored shape; when both are present, the
  // user-part match wins as the single value assigned to `referenced`.
  const userRefMatch = REFERENCED_BLOCK_RE.exec(user);
  if (userRefMatch !== null) {
    referenced = userRefMatch[1];
    user = user.slice(0, userRefMatch.index);
  }

  return {
    user,
    assistant,
    referenced,
  };
}

/** Drop `> `-prefixed quote lines from the user side (D1 council rider). */
export function stripQuoteLines(text: string): { text: string; strippedCount: number } {
  const lines = text.split('\n');
  let strippedCount = 0;
  const kept = lines.filter(line => {
    if (line.startsWith('> ')) {
      strippedCount += 1;
      return false;
    }
    return true;
  });
  return { text: kept.join('\n'), strippedCount };
}
