/**
 * Release-related CLI commands
 *
 * Commands for version management and release preparation.
 */

import type { CAC } from 'cac';

export function registerReleaseCommands(cli: CAC): void {
  // Bump version across all package.json files
  cli
    .command('release:bump <version>', 'Bump version in all package.json files')
    .option('--dry-run', 'Preview changes without applying')
    .example('pnpm ops release:bump 3.0.0-beta.49')
    .example('pnpm ops release:bump 3.0.0 --dry-run')
    .action(async (version: string, options: { dryRun?: boolean }) => {
      const { bumpVersion } = await import('../release/bump-version.js');
      await bumpVersion(version, options);
    });

  // Draft release-notes skeleton from merged PRs since the previous tag
  cli
    .command(
      'release:draft-notes',
      'Draft release-notes skeleton from PRs merged since the previous tag'
    )
    .option('--from <tag>', 'Previous release tag (auto-discovered via `git describe` if omitted)')
    .option('--base <branch>', 'Base branch to query for merged PRs (default: develop)')
    .option('--repo-url <url>', 'GitHub repo URL for the compare-link trailer')
    .example('pnpm ops release:draft-notes')
    .example('pnpm ops release:draft-notes --from v3.0.0-beta.103')
    .example('pnpm ops release:draft-notes > /tmp/notes.md')
    .action(async (options: { from?: string; base?: string; repoUrl?: string }) => {
      const { draftNotes } = await import('../release/draft-notes.js');
      draftNotes(options);
    });

  // Verify a release-notes draft against the actual merged-PR list
  cli
    .command(
      'release:verify-notes',
      'Verify release notes (on stdin) reference all merged PRs in the range exactly once'
    )
    .option('--from <tag>', 'Previous release tag (auto-discovered via `git describe` if omitted)')
    .option('--base <branch>', 'Base branch to query for merged PRs (default: develop)')
    .example('cat /tmp/notes.md | pnpm ops release:verify-notes')
    .example('cat /tmp/notes.md | pnpm ops release:verify-notes --from v3.0.0-beta.103')
    .action(async (options: { from?: string; base?: string }) => {
      const { verifyNotes } = await import('../release/verify-notes.js');
      await verifyNotes(options);
    });

  // Rebase develop onto main after a release PR merges. Full rationale
  // + safety details in `finalize.ts` module-level JSDoc.
  cli
    .command(
      'release:finalize',
      'Rebase develop onto main after a release PR merges (step 6 of the release flow)'
    )
    .option('--dry-run', 'Preview the planned steps without executing')
    .option('--yes', 'Skip the force-push confirmation prompt (required on non-TTY stdin)')
    .example('pnpm ops release:finalize')
    .example('pnpm ops release:finalize --dry-run')
    .example('pnpm ops release:finalize --yes')
    .action(async (options: { dryRun?: boolean; yes?: boolean }) => {
      const { finalizeRelease } = await import('../release/finalize.js');
      await finalizeRelease(options);
    });
}
