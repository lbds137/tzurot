/**
 * Guard Commands
 *
 * Architecture and code quality guard checks.
 */

import type { CAC } from 'cac';

const SUMMARY_OPTION_DESC =
  'Output only the standardized JSONL audit-summary line (for the audit-aggregator)';

export function registerGuardCommands(cli: CAC): void {
  cli
    .command('guard:boundaries', 'Check for architecture boundary violations')
    .option('--verbose', 'Show detailed output')
    .option('--summary', SUMMARY_OPTION_DESC)
    .example('ops guard:boundaries')
    .example('ops guard:boundaries --verbose')
    .example('ops guard:boundaries --summary')
    .action(async (options: { verbose?: boolean; summary?: boolean }) => {
      const { checkBoundaries } = await import('../dev/check-boundaries.js');
      await checkBoundaries(options);
    });

  cli
    .command(
      'guard:duplicate-exports',
      'Check for duplicate exported names across files within each package'
    )
    .option('--verbose', 'Show per-package scan details')
    .option('--package <name>', 'Check only a specific package (api-gateway, bot-client, etc.)')
    .example('ops guard:duplicate-exports')
    .example('ops guard:duplicate-exports --package api-gateway')
    .example('ops guard:duplicate-exports --verbose')
    .action(async (options: { verbose?: boolean; package?: string }) => {
      const { checkDuplicateExports } = await import('../dev/check-duplicate-exports.js');
      await checkDuplicateExports(options);
    });

  cli
    .command(
      'guard:proposal-links',
      'Check that every docs/proposals/backlog/*.md has at least one inbound link'
    )
    .option('--summary', SUMMARY_OPTION_DESC)
    .example('ops guard:proposal-links')
    .example('ops guard:proposal-links --summary')
    .action(async (options: { summary?: boolean }) => {
      const { checkProposalOrphans } = await import('../audits/check-proposal-orphans.js');
      await checkProposalOrphans(options);
    });

  cli
    .command(
      'guard:audit-tool-docs',
      'Check that every registered audit tool has a non-stub WHY.md'
    )
    .option('--summary', SUMMARY_OPTION_DESC)
    .example('ops guard:audit-tool-docs')
    .example('ops guard:audit-tool-docs --summary')
    .action(async (options: { summary?: boolean }) => {
      const { checkAuditToolDocs } = await import('../audits/check-audit-tool-docs.js');
      await checkAuditToolDocs(options);
    });

  cli
    .command(
      'guard:claude-content-refs',
      'Verify skill/rule pnpm-ops command references resolve + flag stale lastUpdated'
    )
    .option('--summary', SUMMARY_OPTION_DESC)
    .example('ops guard:claude-content-refs')
    .example('ops guard:claude-content-refs --summary')
    .action(async (options: { summary?: boolean }) => {
      const { checkClaudeContentRefs } = await import('../audits/check-claude-content-refs.js');
      await checkClaudeContentRefs(options);
    });
}
