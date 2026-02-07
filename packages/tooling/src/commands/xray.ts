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
    .option('--output <file>', 'Write to file instead of stdout')
    .example('pnpm ops xray')
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
          output?: string;
        }
      ) => {
        const { runXray } = await import('../xray/analyzer.js');
        await runXray({
          packages: packages.length > 0 ? packages : undefined,
          format: (options.format as 'terminal' | 'md' | 'json') ?? 'terminal',
          includeTests: options.includeTests,
          includePrivate: options.includePrivate,
          imports: options.imports,
          output: options.output,
        });
      }
    );
}
