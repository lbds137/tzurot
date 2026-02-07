/**
 * Xray Commands
 *
 * Analyze TypeScript codebase structure via AST parsing.
 */

import type { CAC } from 'cac';

export function registerXrayCommands(cli: CAC): void {
  cli
    .command('xray [...packages]', 'Analyze TypeScript codebase structure')
    .option('--format <fmt>', 'Output: terminal, md, json', { default: 'terminal' })
    .option('--include-tests', 'Include test files', { default: false })
    .option('--include-private', 'Include non-exported declarations', { default: false })
    .option('--imports', 'Include import analysis')
    .option('--summary', 'File-level overview without individual declarations')
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

        const { runXray } = await import('../xray/analyzer.js');
        await runXray({
          packages: packages.length > 0 ? packages : undefined,
          format: format as 'terminal' | 'md' | 'json',
          includeTests: options.includeTests,
          includePrivate: options.includePrivate,
          imports: options.imports,
          summary: options.summary,
          output: options.output,
        });
      }
    );
}
