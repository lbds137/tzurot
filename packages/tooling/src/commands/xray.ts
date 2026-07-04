/**
 * Xray Commands
 *
 * Analyze TypeScript codebase structure via AST parsing.
 */

import { relative } from 'node:path';

import type { CAC } from 'cac';

import type { FlatSuppression } from '../xray/formatters/suppressions.js';

/** Plain-text output + pass/fail decision for the suppression gate. */
export interface SuppressionCheckResult {
  failed: boolean;
  /** Per-violation lines (empty on success). */
  violations: string[];
  /** The trailing summary/success line (colorized by the caller). */
  summary: string;
}

/**
 * Pure gate evaluation — no IO — so the `path:line kind` format, the
 * singular/plural summary, the trend-count on success, and the pass/fail
 * decision are unit-testable without mocking process/console (mirrors how
 * `cpd.ts` extracts its threshold logic).
 */
export function evaluateSuppressionCheck(
  unjustified: FlatSuppression[],
  totalCount: number,
  rootDir: string
): SuppressionCheckResult {
  if (unjustified.length === 0) {
    // Preserve the CI trend signal the old bash step printed on every run.
    return {
      failed: false,
      violations: [],
      summary: `✓ No unjustified lint suppressions (${totalCount} total, all justified)`,
    };
  }
  const violations = unjustified.map(
    ({ suppression, filePath }) =>
      `${relative(rootDir, filePath)}:${suppression.line}  ${suppression.kind}`
  );
  const plural = unjustified.length === 1 ? '' : 's';
  return {
    failed: true,
    violations,
    summary:
      `\n❌ ${unjustified.length} unjustified lint suppression${plural} found. ` +
      'Every eslint-disable and ts-expect-error must have a -- justification comment ' +
      '(see .claude/rules/02-code-standards.md).',
  };
}

async function runSuppressionsCheck(packages: string[], includeTests?: boolean): Promise<void> {
  const rootDir = process.cwd();
  const [{ analyzeMonorepo }, suppressions, { default: chalk }] = await Promise.all([
    import('../xray/analyzer.js'),
    import('../xray/formatters/suppressions.js'),
    import('chalk'),
  ]);

  const report = analyzeMonorepo(rootDir, {
    packages: packages.length > 0 ? packages : undefined,
    includeTests,
  });
  const unjustified = suppressions.collectUnjustifiedSuppressions(report);
  const totalCount = suppressions.flattenSuppressions(report).length;
  const { failed, violations, summary } = evaluateSuppressionCheck(
    unjustified,
    totalCount,
    rootDir
  );

  if (!failed) {
    console.log(chalk.green(summary));
    return;
  }
  for (const line of violations) console.error(line);
  console.error(chalk.red(summary));
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
