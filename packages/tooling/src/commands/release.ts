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
}
