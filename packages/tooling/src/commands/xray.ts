/**
 * Xray Commands
 *
 * Analyze TypeScript codebase structure via AST parsing.
 */

import { relative } from 'node:path';

import type { CAC } from 'cac';

/**
 * The `--check` gate: analyze the target, then fail non-zero if any lint
 * suppression lacks a `-- justification`. Extracted from the command action so
 * the action stays a thin dispatcher (keeps cognitive complexity in bounds).
 * Sets `process.exitCode = 1` on violations rather than throwing — mirrors the
 * validation-error style already used in the action.
 */
async function runSuppressionsCheck(packages: string[], includeTests?: boolean): Promise<void> {
  const rootDir = process.cwd();
  const [{ analyzeMonorepo }, { collectUnjustifiedSuppressions }, { default: chalk }] =
    await Promise.all([
      import('../xray/analyzer.js'),
      import('../xray/formatters/suppressions.js'),
      import('chalk'),
    ]);

  const report = analyzeMonorepo(rootDir, {
    packages: packages.length > 0 ? packages : undefined,
    includeTests,
  });
  const unjustified = collectUnjustifiedSuppressions(report);

  if (unjustified.length === 0) {
    console.log(chalk.green('✓ No unjustified lint suppressions'));
    return;
  }

  for (const { suppression, filePath } of unjustified) {
    console.error(`${relative(rootDir, filePath)}:${suppression.line}  ${suppression.kind}`);
  }
  console.error(
    chalk.red(
      `\n❌ ${unjustified.length} unjustified lint suppression${unjustified.length === 1 ? '' : 's'} found. ` +
        'Every eslint-disable and ts-expect-error must have a -- justification comment ' +
        '(see .claude/rules/02-code-standards.md).'
    )
  );
  process.exitCode = 1;
}

export function registerXrayCommands(cli: CAC): void {
  cli
    .command('xray [...packages]', 'Analyze TypeScript codebase structure')
    .option('--format <fmt>', 'Output: terminal, md, json', { default: 'terminal' })
    .option('--include-tests', 'Include test files', { default: false })
    .option('--include-private', 'Include non-exported declarations', { default: false })
    .option('--imports', 'Include import analysis')
    .option('--summary', 'File-level overview without individual declarations')
    .option('--suppressions', 'Show detailed suppression audit report')
    .option('--check', 'Exit non-zero if any lint suppression lacks a justification')
    .option('--output <file>', 'Write to file instead of stdout')
    .example('pnpm ops xray')
    .example('pnpm ops xray --summary')
    .example('pnpm ops xray bot-client --format md')
    .example('pnpm ops xray --format json --output xray.json')
    .example('pnpm ops xray ai-worker --include-private')
    .action(
      async (
        packages: string[],
        options: {
          format?: string;
          includeTests?: boolean;
          includePrivate?: boolean;
          imports?: boolean;
          summary?: boolean;
          suppressions?: boolean;
          check?: boolean;
          output?: string;
        }
      ) => {
        const VALID_FORMATS = ['terminal', 'md', 'json'] as const;
        const format = options.format ?? 'terminal';

        if (!VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])) {
          console.error(
            `Error: Invalid format "${format}". Must be one of: ${VALID_FORMATS.join(', ')}`
          );
          process.exitCode = 1;
          return;
        }

        if (packages.length > 0) {
          const { discoverFiles } = await import('../xray/file-discovery.js');
          const allPackages = discoverFiles(process.cwd()).map(p => p.name);
          const invalid = packages.filter(p => !allPackages.includes(p));

          if (invalid.length > 0) {
            console.error(`Error: Unknown package(s): ${invalid.join(', ')}`);
            console.error(`Available packages: ${allPackages.join(', ')}`);
            process.exitCode = 1;
            return;
          }
        }

        // --check is a CI gate, not a render path. It implies --suppressions and
        // short-circuits before the normal report renders: fail non-zero the
        // moment any suppression lacks a justification. Runs over the same
        // target (packages arg or whole repo) as the render path below.
        if (options.check === true) {
          await runSuppressionsCheck(packages, options.includeTests);
          return;
        }

        const { runXray } = await import('../xray/analyzer.js');
        await runXray({
          packages: packages.length > 0 ? packages : undefined,
          format: format as 'terminal' | 'md' | 'json',
          includeTests: options.includeTests,
          includePrivate: options.includePrivate,
          imports: options.imports,
          summary: options.summary,
          suppressions: options.suppressions,
          output: options.output,
        });
      }
    );
}
