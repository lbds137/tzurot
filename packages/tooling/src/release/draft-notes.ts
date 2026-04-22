/**
 * Generate a release-notes skeleton from PRs merged since the previous tag.
 *
 * Rebase-only workflow means individual commits don't carry PR numbers in
 * their subjects, so we query merged PRs via the GitHub search API rather
 * than parsing `git log`. PR-boundary grouping naturally collapses
 * multi-commit PRs into single line items.
 *
 * Output goes to stdout so the caller can pipe it or redirect to a file:
 *   pnpm ops release:draft-notes > /tmp/notes.md
 */

import chalk from 'chalk';
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';
import { groupBySections, renderMarkdown } from './notes-format.js';

export interface DraftNotesOptions {
  /** Previous release tag to diff against. Auto-discovered via `git describe` if omitted. */
  from?: string;
  /** Base branch to query for merged PRs. Defaults to `develop`. */
  base?: string;
  /** GitHub repo URL for the "Full Changelog" trailer. Defaults to tzurot's. */
  repoUrl?: string;
}

export function draftNotes(options: DraftNotesOptions): void {
  const fromTag = options.from ?? discoverPrevTag();
  const fromTimestamp = tagTimestamp(fromTag);
  const prs = listMergedPrsSince(fromTimestamp, options.base);

  if (prs.length === 0) {
    // Stderr so redirecting stdout to a notes file doesn't inherit this message.
    process.stderr.write(
      chalk.yellow(`No PRs merged since ${fromTag} (${fromTimestamp}). Nothing to draft.\n`)
    );
    return;
  }

  const grouped = groupBySections(prs);
  const markdown = renderMarkdown(grouped, {
    fromTag,
    fromTimestamp,
    repoUrl: options.repoUrl,
  });
  process.stdout.write(markdown);
  process.stdout.write('\n');

  // Summary on stderr so the user sees it when running interactively but
  // it doesn't get captured into the notes file itself.
  const total = prs.length;
  const unparseable = grouped.unparseable.length;
  process.stderr.write(
    chalk.green(
      `\nDrafted notes for ${total} PRs` +
        (unparseable > 0 ? ` (${unparseable} unparseable — review manually)` : '') +
        '.\n'
    )
  );
}
