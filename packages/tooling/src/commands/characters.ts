/**
 * Character-import CLI commands.
 */

import type { CAC } from 'cac';
import chalk from 'chalk';
import { rawOptionValue } from '../utils/cli-args.js';
import type { Environment } from '../utils/env-runner.js';

const FORCE_OPTION_DESC = 'Skip production confirmation prompt';

interface CharactersImportRawOptions {
  env?: string;
  dir?: string;
  apply?: boolean;
  renameMap?: string;
  avatars?: string;
  createNew?: string;
  allowForeign?: string;
  only?: string;
  force?: boolean;
}

export function registerCharactersCommands(cli: CAC): void {
  cli
    .command(
      'characters:import',
      'Bulk-import character cards through the /character import path (dry run unless --apply)'
    )
    .option('--env <env>', 'Environment: local, dev, or prod')
    .option('--dir <dir>', 'Directory of character card JSON files to import (scanned recursively)')
    .option('--apply', 'Write the changes (default is a dry run report)')
    .option('--rename-map <file>', 'JSON file of { oldSlug: newSlug } renames to apply')
    .option(
      '--avatars <file>',
      'JSON manifest of { slug: image path } (relative to the manifest); applies an image only when its content changed since the last apply; changes made outside this importer are not detected; delete the slug entry in docs/local/avatar-import-state.json to force a re-send (that state path resolves against the current working directory; see the printed Avatar state: line)'
    )
    .option(
      '--create-new <slugs>',
      'Comma-separated card slugs allowed to create despite an owned-name match'
    )
    .option(
      '--allow-foreign <slugs>',
      'Comma-separated card slugs allowed to update a row owned by someone else'
    )
    .option('--only <slugs>', 'Comma-separated card slugs to import (default: every card in --dir)')
    .option('--force', FORCE_OPTION_DESC)
    // Id-shaped flag: read from raw argv, never cac's parsed options — an
    // all-digit Discord snowflake is silently coerced to a Number by cac/mri
    // (see rawOptionValue's own header comment). Guarded by
    // commands/snowflakeFlagArgv.test.ts.
    .option('--as-user <discordId>', 'Act as this Discord user instead of the bot owner')
    .action(async (options: CharactersImportRawOptions) => {
      if (options.env === undefined) {
        console.error(chalk.red('--env is required (local, dev, or prod)'));
        process.exitCode = 1;
        return;
      }
      if (options.dir === undefined) {
        console.error(chalk.red('--dir is required'));
        process.exitCode = 1;
        return;
      }
      const { charactersImport } = await import('../characters/import.js');
      await charactersImport({
        env: options.env as Environment,
        dir: options.dir,
        apply: options.apply,
        renameMap: options.renameMap,
        avatars: options.avatars,
        createNew: options.createNew,
        allowForeign: options.allowForeign,
        only: options.only,
        force: options.force,
        asUser: rawOptionValue(process.argv, '--as-user'),
      });
    });
}
