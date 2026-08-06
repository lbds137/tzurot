/**
 * CLI helpers for the LTM backfill command.
 * Presentation and validation logic extracted from backfill-ltm.ts.
 */

import chalk from 'chalk';

import { UsageError } from '../utils/errors.js';

/** Validate and parse date range options */
export function parseDateRange(from: string, to: string): { fromDate: Date; toDate: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new UsageError('Invalid date format. Use YYYY-MM-DD.');
  }
  if (fromDate >= toDate) {
    throw new UsageError('--from must be before --to');
  }

  return { fromDate, toDate };
}

/** Print dry-run preview */
const PREVIEW_LIMIT = 5;
export function printDryRunPreview(uniquePairs: Map<string, { content: string }>): void {
  console.log(chalk.blue(`\n🔬 DRY RUN — would backfill ${uniquePairs.size} memories`));
  let count = 0;
  for (const [id, { content }] of uniquePairs) {
    if (count >= PREVIEW_LIMIT) {
      console.log(chalk.dim(`   ... and ${uniquePairs.size - PREVIEW_LIMIT} more`));
      break;
    }
    const preview = content.length > 80 ? content.substring(0, 80) + '...' : content;
    console.log(chalk.dim(`   ${id}: ${preview}`));
    count++;
  }
}
