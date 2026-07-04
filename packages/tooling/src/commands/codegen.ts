/**
 * Codegen Commands
 *
 * Registers `pnpm ops codegen:routes` (route manifest → client classes) and
 * `pnpm ops codegen:command-types` (bot-client command files → typed option
 * schemas). Drift detection via `--check` on each is what CI uses to verify
 * that committed generated files match what the current sources would produce.
 */

import type { CAC } from 'cac';
import chalk from 'chalk';

export function registerCodegenCommands(cli: CAC): void {
  cli
    .command('codegen:routes', 'Generate route-manifest-derived client classes')
    .option('--check', 'Exit non-zero if any generated file would change (CI mode)')
    .example('ops codegen:routes')
    .example('ops codegen:routes --check')
    .action(async (options: { check?: boolean }) => {
      const { runCodegen, summarizeManifest } = await import('../codegen/routes.js');

      const summary = summarizeManifest();
      console.log(
        chalk.dim(
          `Route manifest: ${summary.total} routes (${summary.internal} internal, ${summary.admin} admin, ${summary.user} user)`
        )
      );

      const result = runCodegen({ check: options.check });

      if (options.check === true) {
        if (result.upToDate) {
          console.log(chalk.green('✓ All generated files up-to-date'));
          return;
        }
        console.error(chalk.red('✗ Generated files out of sync with manifest:'));
        for (const path of result.drifted) {
          console.error(chalk.red(`  ${path}`));
        }
        console.error(
          chalk.yellow('\nRun `pnpm ops codegen:routes` to regenerate, then commit the result.')
        );
        process.exit(1);
      } else {
        console.log(chalk.green(`✓ Generated ${Object.keys(result.files).length} files:`));
        for (const path of Object.keys(result.files)) {
          console.log(chalk.dim(`  ${path}`));
        }
      }
    });

  cli
    .command('codegen:command-types', 'Generate type-safe slash-command option schemas')
    .option('--check', 'Exit non-zero if the generated file would change (CI mode)')
    .example('ops codegen:command-types')
    .example('ops codegen:command-types --check')
    .action(async (options: { check?: boolean }) => {
      const { runCommandTypesCodegen } = await import('../codegen/command-types.js');
      const result = runCommandTypesCodegen({ check: options.check });

      if (options.check === true) {
        if (result.upToDate) {
          console.log(chalk.green('✓ commandOptions.ts up-to-date'));
          return;
        }
        console.error(chalk.red('✗ commandOptions.ts out of sync with the command files:'));
        for (const path of result.drifted) {
          console.error(chalk.red(`  ${path}`));
        }
        console.error(
          chalk.yellow(
            '\nRun `pnpm ops codegen:command-types` to regenerate, then commit the result.'
          )
        );
        process.exit(1);
      } else {
        const generated = Object.values(result.files)[0] ?? '';
        const schemaCount = (generated.match(/export const \w+Options/g) ?? []).length;
        console.log(chalk.green(`✓ Generated commandOptions.ts (${schemaCount} schemas)`));
      }
    });
}
