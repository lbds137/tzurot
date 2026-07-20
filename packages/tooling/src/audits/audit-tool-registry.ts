/**
 * Audit Tool Registry
 *
 * Single source of truth for which `pnpm ops` commands are considered
 * "audit tools" requiring a WHY.md. Used by `guard:audit-tool-docs` to
 * structurally enforce that every audit tool has decay-prevention
 * documentation colocated with its implementation.
 *
 * Adding a new audit tool: append an entry here AND create the WHY.md
 * file at the indicated `whyPath`. The guard will fail CI until both
 * exist.
 *
 * Removing a tool: delete the entry here AND delete the WHY.md.
 * Don't leave orphan WHY.md files behind — neither this guard nor
 * `pnpm knip` will detect them (knip traces import graphs, but the
 * `whyPath` strings are data, not imports). A future iteration may add
 * an orphan-WHY.md sweep here; for now, it's a manual cleanup step.
 *
 * What "audit-class" means in this project:
 * - Reports a code-quality / data-quality measurement
 * - Runs periodically (CI, pre-commit, or manual periodic invocation)
 * - Has a threshold that decides pass/fail or warn/info
 *
 * Diagnostic tools that are user-invoked for inspection (like
 * `inspect:queue`, `inspect:dlq`, `inspect:tts-configs`) are NOT
 * audit tools — they don't have a threshold or a pass/fail verdict.
 * They're shells for ad-hoc operator queries.
 */

export interface AuditToolEntry {
  /** Command name as it appears in `pnpm ops <command>`. Multi-command files (e.g., cpd:filtered / cpd:check / cpd:update-baseline) use the file's representative command. */
  command: string;
  /**
   * Path to the WHY.md file, relative to the repo root. The guard reads
   * this exact path; it doesn't auto-derive from the command name.
   */
  whyPath: string;
  /** Brief one-liner about what this tool checks. Surfaced in registry overview output. */
  description: string;
}

export const AUDIT_TOOL_REGISTRY: readonly AuditToolEntry[] = [
  {
    command: 'lint:complexity-report',
    whyPath: 'packages/tooling/src/lint/complexity-report.WHY.md',
    description: 'ESLint max-* rule findings at 80% of hard limits',
  },
  {
    command: 'db:check-safety',
    whyPath: 'packages/tooling/src/db/check-migration-safety.WHY.md',
    description: 'Migration SQL scanned for protected-index drops',
  },
  {
    command: 'db:check-drift',
    whyPath: 'packages/tooling/src/db/check-migration-drift.WHY.md',
    description: 'Migration file checksums vs _prisma_migrations table',
  },
  {
    command: 'guard:proposal-links',
    whyPath: 'packages/tooling/src/audits/check-proposal-orphans.WHY.md',
    description: 'docs/proposals/backlog/*.md must have inbound links',
  },
  {
    command: 'guard:boundaries',
    whyPath: 'packages/tooling/src/dev/check-boundaries.WHY.md',
    description: 'Service-boundary import rules (bot-client/Prisma, etc.)',
  },
  {
    command: 'cpd:filtered',
    whyPath: 'packages/tooling/src/commands/cpd.WHY.md',
    description: 'Filtered copy-paste detection ratchet + post-filter',
  },
  {
    command: 'dev:schema-audit',
    whyPath: 'packages/tooling/src/dev/schema-audit.WHY.md',
    description: 'Prisma `?` fields with non-null-meaningful semantics',
  },
  {
    command: 'dev:dead-files',
    whyPath: 'packages/tooling/src/dev/find-dead-files.WHY.md',
    description: 'Production files imported only by their own tests',
  },
  {
    command: 'test:audit',
    whyPath: 'packages/tooling/src/test/audit-unified.WHY.md',
    description: 'Service + contract test coverage ratchet',
  },
  {
    command: 'mutation:check',
    whyPath: 'packages/tooling/src/test/mutation-check.WHY.md',
    description: 'Mutation-score ratchet over Stryker reports (per-package floors)',
  },
  {
    command: 'lines:check',
    whyPath: 'packages/tooling/src/audits/lines-check.WHY.md',
    description: 'Line-count ratchet over always-loaded context surfaces (rules + CURRENT.md)',
  },
  {
    command: 'voice-refs:audit',
    whyPath: 'packages/tooling/src/voice/audit-references.WHY.md',
    description: 'Voice reference durations vs Mistral 30s cap',
  },
  {
    command: 'xray',
    whyPath: 'packages/tooling/src/xray/WHY.md',
    description: 'Monorepo structural report + lint-suppression audit',
  },
  {
    // The guard registers itself — the system enforces its own rule, so if
    // this tool ever drifts into stub status, its own reminder is the
    // prompt to fix or delete. The recursion stops here (no meta-meta-guard).
    command: 'guard:audit-tool-docs',
    whyPath: 'packages/tooling/src/audits/check-audit-tool-docs.WHY.md',
    description: 'Registered audit tools must have a non-stub WHY.md',
  },
  {
    command: 'guard:claude-content-refs',
    whyPath: 'packages/tooling/src/audits/check-claude-content-refs.WHY.md',
    description: 'Skill/rule pnpm ops references resolve + lastUpdated freshness',
  },
  {
    command: 'commands:audit',
    whyPath: 'packages/tooling/src/dev/commandsAudit.WHY.md',
    description: 'Slash-command surface inventory + consistency (category/desc/handlers)',
  },
  // NOTE: `memory:analyze` is intentionally NOT in the registry. It's a
  // one-shot remediation tool for the retry-loop-bug cleanup, not a
  // periodic audit. Its WHY.md still exists as operator documentation
  // but doesn't meet the audit-class criteria ("runs periodically with
  // a threshold"). If memory:analyze gains an ongoing periodic use case,
  // re-add it here. The WHY.md path is on the UNREGISTERED_WHY_PATHS
  // allowlist below so the orphan-WHY sweep doesn't flag it.
];

/**
 * WHY.md paths that intentionally do NOT correspond to a registered audit
 * tool. The orphan-WHY sweep in `checkAuditToolDocsFromRegistry` walks
 * `packages/tooling/src/**\/*.WHY.md` and asserts each path either
 * matches a registry entry OR appears here.
 *
 * Entries document why a WHY.md exists outside the registry — typically
 * operator-tool documentation that doesn't meet audit-class criteria but
 * is still worth preserving as decay-zone context.
 */
export const UNREGISTERED_WHY_PATHS: readonly string[] = [
  // Documents `memory:analyze`, intentionally not registered (one-shot
  // remediation tool, not a periodic audit).
  'packages/tooling/src/memory/cleanup-duplicates.WHY.md',
];
