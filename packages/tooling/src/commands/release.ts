/**
 * Release-related CLI commands
 *
 * Commands for version management and release preparation.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';

/**
 * Shared option help text for the three commands built on the same
 * `discoverPrevTag` / `tagTimestamp` / `listMergedPrsSince` enumeration
 * (draft-notes, verify-notes, range) — kept as one constant so the three
 * copies can't drift and so a fourth `.option('--from ...)` doesn't trip
 * `sonarjs/no-duplicate-string`.
 */
const FROM_TAG_FLAG = '--from <tag>';
const FROM_TAG_HELP = 'Previous release tag (auto-discovered via `git describe` if omitted)';
const BASE_BRANCH_FLAG = '--base <branch>';
const BASE_BRANCH_HELP = 'Base branch to query for merged PRs (default: develop)';

/**
 * `release:range` alone also diffs `origin/<base>` to size the range, so the
 * range-specific wording lives here rather than widening the shared constant.
 * That constant is shared by three commands precisely so their `--help` cannot
 * drift; putting range-only text inside it makes the description false for
 * `draft-notes` and `verify-notes` — the same drift, entered through the
 * content instead of through copies.
 */
const RANGE_BASE_BRANCH_HELP =
  'Base branch to query for merged PRs, also diffed as origin/<base> to size the range (fetches origin; default: develop)';

export function registerReleaseCommands(cli: CAC): void {
  // Bump version across all package.json files
  cli
    .command('release:bump <version>', 'Bump version in all package.json files')
    .option('--dry-run', 'Preview changes without applying')
    .option(
      '--allow-stale-current',
      'Bump even when CURRENT.md still declares the previous release (skips the reset gate)'
    )
    .example('pnpm ops release:bump 3.0.0-beta.49')
    .example('pnpm ops release:bump 3.0.0 --dry-run')
    .action(async (version: string, options: { dryRun?: boolean; allowStaleCurrent?: boolean }) => {
      const { bumpVersion } = await import('../release/bump-version.js');
      await bumpVersion(version, options);
    });

  // Draft release-notes skeleton from merged PRs since the previous tag
  cli
    .command(
      'release:draft-notes',
      'Draft release-notes skeleton from PRs merged since the previous tag'
    )
    .option(FROM_TAG_FLAG, FROM_TAG_HELP)
    .option(BASE_BRANCH_FLAG, BASE_BRANCH_HELP)
    .option('--repo-url <url>', 'GitHub repo URL for the compare-link trailer')
    .example('pnpm ops release:draft-notes')
    .example('pnpm ops release:draft-notes --from v3.0.0-beta.103')
    .example('pnpm ops release:draft-notes > /tmp/notes.md')
    .action(async (options: { from?: string; base?: string; repoUrl?: string }) => {
      const { draftNotes } = await import('../release/draft-notes.js');
      draftNotes(options);
    });

  // Deterministic ship-inventory: PRs merged since the previous tag,
  // classified runtime vs. non-runtime. Reuses the same enumeration as
  // release:draft-notes so the two can never disagree on the PR list.
  cli
    .command(
      'release:range',
      'List PRs merged since the previous tag, classified runtime vs. non-runtime, with the range diff size (fetches origin)'
    )
    .option(FROM_TAG_FLAG, FROM_TAG_HELP)
    .option(BASE_BRANCH_FLAG, RANGE_BASE_BRANCH_HELP)
    .example('pnpm ops release:range')
    .example('pnpm ops release:range --from v3.0.0-beta.103')
    .action(async (options: { from?: string; base?: string }) => {
      const { releaseRange } = await import('../release/range.js');
      releaseRange(options);
    });

  // Verify a release-notes draft against the actual merged-PR list
  cli
    .command(
      'release:verify-notes',
      'Verify release notes (on stdin) reference all merged PRs in the range exactly once'
    )
    .option(FROM_TAG_FLAG, FROM_TAG_HELP)
    .option(BASE_BRANCH_FLAG, BASE_BRANCH_HELP)
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

  registerPublishCommand(cli);
  registerPremigrateCommand(cli);
}

/**
 * Apply prod migrations BEFORE merging the release PR — closes the
 * breaking-migration deploy window. Extracted from `registerReleaseCommands`
 * for the same reason as `registerPublishCommand`: to keep that function under
 * the max-lines-per-function limit. Full rationale in `premigrate.ts`, which
 * also documents the two gates this command's flags override — the
 * destructive-shape scan (`--allow-destructive`) and the author-declared
 * apply-after-deploy marker (`--allow-marked`).
 */
function registerPremigrateCommand(cli: CAC): void {
  cli
    .command(
      'release:premigrate',
      'Apply prod migrations BEFORE merging the release PR (closes the breaking-migration deploy window)'
    )
    .option('--env <env>', 'Target environment', { default: 'prod' })
    .option('--dry-run', 'Preview: show new migrations + status without applying')
    .option('--force', 'Skip the production confirmation prompt (required on non-TTY stdin)')
    .option(
      '--allow-destructive',
      'Proceed even if destructive migration shapes are detected (use only with a maintenance window)'
    )
    .option(
      '--allow-marked',
      'Proceed even if a migration is marked apply-after-deploy (it will land before the new code)'
    )
    .example('pnpm ops release:premigrate --dry-run')
    .example('pnpm ops release:premigrate')
    .action(
      async (options: {
        env?: Environment;
        dryRun?: boolean;
        force?: boolean;
        allowDestructive?: boolean;
        allowMarked?: boolean;
      }) => {
        const { premigrate } = await import('../release/premigrate.js');
        await premigrate(options);
      }
    );
}

/**
 * Tag + publish the GitHub Release with the correct latest/prerelease flags
 * (release-flow steps 7–8). Extracted from `registerReleaseCommands` to keep
 * that function under the max-lines-per-function limit. Automates the flag
 * dance a from-memory run drops: the newest always holds `latest`; a
 * prerelease-channel (alpha/beta/rc) version also demotes the immediately-
 * previous tag to prerelease, while a stable release leaves its predecessor
 * untouched. Full rationale in `publish.ts` module-level JSDoc.
 */
function registerPublishCommand(cli: CAC): void {
  cli
    .command(
      'release:publish <version>',
      'Tag + create the GitHub Release with correct latest/prerelease flags'
    )
    .option('--notes-file <path>', 'Path to the release-notes markdown (required)')
    .option('--target <branch>', 'Branch the tag/release points at (default: main)')
    .option('--dry-run', 'Preview the steps without tagging, releasing, or flipping')
    .example('pnpm ops release:publish 3.0.0-beta.155 --notes-file /tmp/notes.md')
    .example('pnpm ops release:publish 3.0.0 --notes-file /tmp/notes.md   # stable: no demote')
    .action(
      async (
        version: string,
        options: { notesFile?: string; target?: string; dryRun?: boolean }
      ) => {
        if (options.notesFile === undefined || options.notesFile.length === 0) {
          throw new UsageError(
            '--notes-file <path> is required (prepare notes first, e.g. release:draft-notes).'
          );
        }
        const { publishRelease } = await import('../release/publish.js');
        publishRelease(version, {
          notesFile: options.notesFile,
          target: options.target,
          dryRun: options.dryRun,
        });
      }
    );
}
