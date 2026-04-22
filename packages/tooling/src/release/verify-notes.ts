/**
 * Verify release notes against merged PRs in the tag-to-HEAD range.
 *
 * Reads notes markdown from stdin, extracts `#N` refs via regex, and
 * cross-checks against the PR list from GitHub for the range. Reports:
 *  - Missing: PRs merged in range but not referenced in notes
 *  - Extra: `#N` refs in notes that don't match any merged PR in range
 *  - Duplicate: `#N` appearing more than once in notes
 *
 * Exits 1 if any class of issue is found, 0 if the notes cleanly cover
 * all merged PRs exactly once — suitable for CI / pre-publish gating.
 */

import chalk from 'chalk';
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';

export interface VerifyNotesOptions {
  from?: string;
}

export async function verifyNotes(options: VerifyNotesOptions): Promise<void> {
  // Read notes from stdin. `setEncoding('utf-8')` makes each chunk a string;
  // without it, chunks are `Buffer` objects and `+= chunk` only works via
  // implicit coercion.
  process.stdin.setEncoding('utf-8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (input.trim().length === 0) {
    process.stderr.write(
      chalk.red('Error: no input on stdin. Pipe release notes into this command.\n')
    );
    process.exit(1);
  }

  const notesRefs = extractPrRefs(input);

  const fromTag = options.from ?? discoverPrevTag();
  const fromTimestamp = tagTimestamp(fromTag);
  const mergedPrs = listMergedPrsSince(fromTimestamp);
  const mergedNumbers = new Set(mergedPrs.map(p => p.number));

  const { missing, extra, duplicates } = classifyRefs(notesRefs, mergedNumbers);

  let hasIssues = false;

  if (missing.length > 0) {
    process.stderr.write(chalk.red(`\nMissing (${missing.length}) — merged but not in notes:\n`));
    // `missing` and `extra` already come sorted from classifyRefs.
    for (const n of missing) {
      const pr = mergedPrs.find(p => p.number === n);
      process.stderr.write(`  #${n}: ${pr?.title ?? '(title unknown)'}\n`);
    }
    hasIssues = true;
  }

  if (extra.length > 0) {
    process.stderr.write(
      chalk.yellow(
        `\nExtra (${extra.length}) — referenced in notes but not merged in ${fromTag}..HEAD:\n`
      )
    );
    for (const n of extra) {
      process.stderr.write(`  #${n}\n`);
    }
    hasIssues = true;
  }

  if (duplicates.length > 0) {
    process.stderr.write(
      chalk.yellow(`\nDuplicate (${duplicates.length}) — referenced more than once in notes:\n`)
    );
    for (const n of duplicates) {
      process.stderr.write(`  #${n}\n`);
    }
    hasIssues = true;
  }

  if (!hasIssues) {
    process.stderr.write(
      chalk.green(
        `\n✅ Notes reference all ${mergedPrs.length} merged PRs in ${fromTag}..HEAD exactly once.\n`
      )
    );
    return;
  }

  process.exit(1);
}

/**
 * Extract PR refs from notes markdown.
 *
 * Matches the `(#N)` format emitted by `release:draft-notes`. Deliberately
 * paren-wrapped to filter out bare `#N` references in prose (e.g., "fixes
 * #45 in upstream") — those no longer surface as spurious `extra` entries.
 *
 * Does NOT require line-end: `(#N)` mid-sentence still matches. In the
 * generator's canonical output that's a non-issue (every `(#N)` is
 * line-terminal), but a hand-edited draft that weaves a ref into prose
 * will count it too. Accepted: hand-edits citing a merged PR mid-sentence
 * should be classified as a legitimate reference, not noise.
 */
export function extractPrRefs(notes: string): number[] {
  const refs: number[] = [];
  for (const match of notes.matchAll(/\(#(\d+)\)/g)) {
    refs.push(parseInt(match[1], 10));
  }
  return refs;
}

export interface RefClassification {
  /** PRs merged in range but absent from notes. */
  missing: number[];
  /** Refs in notes but not in the merged-PR set for the range. */
  extra: number[];
  /** Refs appearing more than once in notes. */
  duplicates: number[];
}

/**
 * Classify extracted PR refs against the merged-PR set for the range.
 * Pure function — extracted from the orchestrator so the diff logic is
 * unit-testable without mocking `process.exit`.
 *
 * Returned arrays are sorted ascending so callers get a stable order
 * regardless of Set iteration order (Set iterates in insertion order,
 * which could be chronological-by-merge rather than numerical depending
 * on how the caller built `mergedNumbers`).
 */
export function classifyRefs(notesRefs: number[], mergedNumbers: Set<number>): RefClassification {
  const duplicates = findDuplicates(notesRefs);
  const notesPrSet = new Set(notesRefs);
  const missing = [...mergedNumbers].filter(n => !notesPrSet.has(n)).sort((a, b) => a - b);
  const extra = [...notesPrSet].filter(n => !mergedNumbers.has(n)).sort((a, b) => a - b);
  return { missing, extra, duplicates };
}

/**
 * Return the set of numbers that appear more than once in `refs`.
 */
export function findDuplicates(refs: number[]): number[] {
  const counts = new Map<number, number>();
  for (const n of refs) {
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const dupes: number[] = [];
  for (const [n, count] of counts) {
    if (count > 1) {
      dupes.push(n);
    }
  }
  return dupes.sort((a, b) => a - b);
}
