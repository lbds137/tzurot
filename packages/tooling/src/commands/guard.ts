/**
 * Guard Commands
 *
 * Architecture and code quality guard checks.
 */

import type { CAC } from 'cac';

const SUMMARY_OPTION_DESC =
  'Output only the standardized JSONL audit-summary line (for the audit-aggregator)';
const BASELINE_OPTION = '--baseline <path>';
const BASELINE_OPTION_DESC = 'Path to baseline JSON';

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

  registerSyncGuards(cli);

  cli
    .command(
      'guard:dockerfile-dist',
      'Check service Dockerfile runner stages copy every runtime workspace dep dist'
    )
    .option('--verbose', 'Show per-service results including skips')
    .example('ops guard:dockerfile-dist')
    .example('ops guard:dockerfile-dist --verbose')
    .action(async (options: { verbose?: boolean }) => {
      const { checkDockerfileDist } = await import('../dev/check-dockerfile-dist.js');
      await checkDockerfileDist(options);
    });

  cli
    .command(
      'guard:workflow-sync',
      'Fail when the claude workflow files differ from origin/main (develop-first changes to them silently disable claude-review)'
    )
    .option('--base <branch>', 'Override the merge-target used for the main-cut skip decision')
    .example('ops guard:workflow-sync')
    .example('ops guard:workflow-sync --base main')
    .action(async (options: { base?: string }) => {
      const { checkWorkflowSync } = await import('../dev/check-workflow-sync.js');
      checkWorkflowSync(options);
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

  registerMetaGuards(cli);
  registerLinesCommands(cli);
  registerHealthCommand(cli);
}

/** Binary source sync-checks (no threshold / WHY.md / --summary). */
function registerSyncGuards(cli: CAC): void {
  cli
    .command(
      'guard:no-export-star',
      'Fail if any production source uses `export *` (re-masks knip)'
    )
    .example('ops guard:no-export-star')
    .action(async () => {
      const { checkNoExportStar } = await import('../dev/check-no-export-star.js');
      checkNoExportStar();
    });

  cli
    .command(
      'guard:prompt-tags',
      'Fail if a structural prompt tag is emitted but not classified (protected vs known-unprotected)'
    )
    .example('ops guard:prompt-tags')
    .action(async () => {
      const { checkPromptTags } = await import('../dev/check-prompt-tags.js');
      checkPromptTags();
    });

  cli
    .command(
      'guard:commands-doc',
      'Fail when docs/commands.md drifts from the bot-client command modules (rendered live on the website)'
    )
    .example('ops guard:commands-doc')
    .action(async () => {
      const { checkCommandsDoc } = await import('../dev/check-commands-doc.js');
      checkCommandsDoc();
    });

  cli
    .command(
      'guard:monitor-command',
      'Fail when the canonical CI-monitor command drifts between the hook, the rule, and the skill'
    )
    .example('ops guard:monitor-command')
    .action(async () => {
      const { checkMonitorCommand } = await import('../dev/check-monitor-command.js');
      checkMonitorCommand();
    });

  cli
    .command(
      'guard:repo-settings',
      'Fail when deletion of a long-lived branch (main, develop) is reachable via GitHub settings'
    )
    .option('--json', 'Emit the raw settings surface as JSON')
    .example('ops guard:repo-settings')
    .example('ops guard:repo-settings --json')
    .action(async (options: { json?: boolean }) => {
      const { checkRepoSettings } = await import('../dev/check-repo-settings.js');
      checkRepoSettings(options);
    });

  cli
    .command(
      'guard:hook-probes',
      'Fail when a hook script has no probe harness (or reason), or when any probe harness fails'
    )
    .example('ops guard:hook-probes')
    .action(async () => {
      const { checkHookProbes } = await import('../dev/check-hook-probes.js');
      checkHookProbes();
    });

  cli
    .command(
      'guard:ops-doc',
      'Fail when a registered pnpm ops command has no row in docs/reference/tooling/OPS_CLI_REFERENCE.md'
    )
    .example('ops guard:ops-doc')
    .action(async () => {
      const { checkOpsDoc } = await import('../dev/check-ops-doc.js');
      checkOpsDoc();
    });
}

/**
 * Always-loaded context line ratchet (audit-class; see lines-check.WHY.md).
 * Lives with the guards because it gates the same always-loaded `.claude/`
 * surface family as guard:claude-content-refs.
 */
function registerLinesCommands(cli: CAC): void {
  cli
    .command(
      'lines:check',
      'Fail if an always-loaded context surface exceeded its line or byte budget (CI gate)'
    )
    .option(BASELINE_OPTION, BASELINE_OPTION_DESC, {
      default: '.github/baselines/lines-baseline.json',
    })
    .option('--summary', SUMMARY_OPTION_DESC)
    .option(
      '--breakdown',
      'Also rank every file in each surface worst-first by bytes (the trim order)'
    )
    .example('ops lines:check')
    .example('ops lines:check --summary')
    .example('ops lines:check --breakdown')
    .action(async (options: { baseline: string; summary?: boolean; breakdown?: boolean }) => {
      const { runLinesCheck } = await import('../audits/lines-check.js');
      runLinesCheck(options);
    });

  cli
    .command(
      'lines:update-baseline',
      'Write current surface line+byte counts to the baseline (run after intentional growth or a trim)'
    )
    .option(BASELINE_OPTION, BASELINE_OPTION_DESC, {
      default: '.github/baselines/lines-baseline.json',
    })
    .option('--dry-run', 'Show the diff without writing the file')
    .option(
      '--surface <name>',
      'Refresh only this surface (rules|current); the others keep their recorded numbers'
    )
    .example('ops lines:update-baseline --dry-run')
    .example('ops lines:update-baseline --surface rules')
    .action(async (options: { baseline: string; dryRun?: boolean; surface?: string }) => {
      const { runLinesUpdateBaseline } = await import('../audits/lines-check.js');
      runLinesUpdateBaseline(options);
    });
}

/**
 * Guards about the gate system itself: taxonomy single-sourcing and
 * local-vs-CI check parity.
 */
function registerMetaGuards(cli: CAC): void {
  cli
    .command(
      'guard:test-taxonomy',
      'Verify the test-tier taxonomy is single-sourced (TESTING.md) and linked from the rule + skill'
    )
    .example('ops guard:test-taxonomy')
    .action(async () => {
      const { checkTestTaxonomyCommand } = await import('../dev/check-test-taxonomy.js');
      await checkTestTaxonomyCommand();
    });

  cli
    .command(
      'guard:gate-parity',
      'Fail when the local pnpm-quality chain and the CI lint job drift (allowlisted asymmetries excepted)'
    )
    .example('ops guard:gate-parity')
    .action(async () => {
      const { checkGateParity } = await import('../dev/check-gate-parity.js');
      checkGateParity();
    });
}

/**
 * The Layer-5 audit aggregator — runs every summary-capable static audit
 * tool and prints one consolidated report (see audits/health.ts).
 */
function registerHealthCommand(cli: CAC): void {
  cli
    .command('health', 'Run all summary-capable audit tools and aggregate one health report')
    .example('ops health')
    .action(async () => {
      const { runHealth } = await import('../audits/health.js');
      runHealth();
    });

  cli
    .command(
      'health:post-webhook',
      'Chunk a health report and post it to the audit-health Discord webhook'
    )
    .option('--file <path>', 'Report file to post (default: health-report.txt)')
    .example('ops health:post-webhook')
    .example('ops health:post-webhook --file health-report.txt')
    .action(async (options: { file?: string }) => {
      const { runHealthWebhookPost } = await import('../audits/health-webhook-post.js');
      await runHealthWebhookPost(options);
    });
}
