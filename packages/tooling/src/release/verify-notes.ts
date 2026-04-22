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
  // Read notes from stdin.
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk as string;
  }

  if (input.trim().length === 0) {
    process.stderr.write(
      chalk.red('Error: no input on stdin. Pipe release notes into this command.\n')
    );
    process.exit(1);
  }

  // Extract PR refs from notes — match `#<digits>` anywhere in the text.
  const notesRefs: number[] = [];
  for (const match of input.matchAll(/#(\d+)/g)) {
    notesRefs.push(parseInt(match[1], 10));
  }

  const duplicates = findDuplicates(notesRefs);
  const notesPrSet = new Set(notesRefs);

  const fromTag = options.from ?? discoverPrevTag();
  const fromTimestamp = tagTimestamp(fromTag);
  const mergedPrs = listMergedPrsSince(fromTimestamp);
  const mergedNumbers = new Set(mergedPrs.map(p => p.number));

  const missing = [...mergedNumbers].filter(n => !notesPrSet.has(n));
  const extra = [...notesPrSet].filter(n => !mergedNumbers.has(n));

  let hasIssues = false;

  if (missing.length > 0) {
    process.stderr.write(chalk.red(`\nMissing (${missing.length}) — merged but not in notes:\n`));
    for (const n of missing.sort((a, b) => a - b)) {
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
    for (const n of extra.sort((a, b) => a - b)) {
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
 * Return the set of numbers that appear more than once in `refs`.
 * Exported for colocated testing without needing the verify-notes
 * orchestrator to be invoked.
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
