/**
 * Audit Tool Documentation Guard
 *
 * Structural enforcement for Layer 2 of the periodic-audit-enforcement
 * proposal: every audit tool listed in `AUDIT_TOOL_REGISTRY` must have a
 * non-stub WHY.md file at the registered path.
 *
 * Fails CI when:
 * - A registered tool's WHY.md doesn't exist
 * - A registered tool's WHY.md is below the minimum-content threshold
 *   (an empty or stub file isn't useful at month-4 reminder time)
 *
 * The "minimum content" check is deliberately loose — it doesn't validate
 * structure (no required headings, no template enforcement). The goal is to
 * catch placeholder files like "# TODO: write this later" without dictating
 * exact format. A WHY.md with 200+ characters of non-frontmatter body
 * content passes; an empty file or a one-line stub fails. Tunable via
 * `MIN_WHY_CONTENT_CHARS` below.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { emitSummary } from './summary.js';
import { AUDIT_TOOL_REGISTRY, type AuditToolEntry } from './audit-tool-registry.js';

export interface AuditToolDocsCheckResult {
  totalTools: number;
  /** Tools whose WHY.md file is missing entirely. */
  missing: { command: string; whyPath: string }[];
  /** Tools whose WHY.md exists but is below the content threshold. */
  stubs: { command: string; whyPath: string; chars: number }[];
}

/**
 * Minimum-content threshold for a WHY.md to count as "real" documentation.
 * Tuned to reject empty files and one-line placeholders without dictating
 * a specific structure.
 *
 * Counts characters of non-frontmatter content (frontmatter is treated as
 * metadata, not content). A WHY.md with just a heading + one sentence will
 * be under this threshold and correctly flagged as a stub.
 */
const MIN_WHY_CONTENT_CHARS = 200;

/**
 * Pure check function. Reads each registered tool's WHY.md and classifies
 * it as missing / stub / ok. No stdout writes; no process.exit. Exported
 * for testing.
 */
export function checkAuditToolDocsFromRegistry(
  repoRoot: string,
  registry: readonly AuditToolEntry[] = AUDIT_TOOL_REGISTRY
): AuditToolDocsCheckResult {
  const missing: AuditToolDocsCheckResult['missing'] = [];
  const stubs: AuditToolDocsCheckResult['stubs'] = [];

  for (const entry of registry) {
    const fullPath = join(repoRoot, entry.whyPath);

    let content: string;
    try {
      // Confirm it's a regular file before reading — a directory at the
      // expected path would be a separate misconfiguration the operator
      // should see, not a "missing" or "stub" miscategorization. The
      // try/catch covers the ENOENT case directly (no separate
      // existsSync check needed — that would add a TOCTOU window).
      const stat = statSync(fullPath);
      if (!stat.isFile()) {
        missing.push({ command: entry.command, whyPath: entry.whyPath });
        continue;
      }
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      missing.push({ command: entry.command, whyPath: entry.whyPath });
      continue;
    }

    // Strip a leading YAML frontmatter block (between `---` lines) before
    // measuring content. Frontmatter is metadata; the test of "is this a
    // real WHY.md?" is whether the body has substance.
    //
    // The trailing `[^\n]*(?:\r?\n|$)` handles three shapes:
    // - normal: closing `---` followed by `\r?\n` and a body line
    // - end-of-file: closing `---` is the last line, no trailing newline
    // - malformed: closing `---` immediately followed by non-whitespace
    //   on the same line (e.g. `---# Heading`) — `[^\n]*` consumes the
    //   trailing characters so the strip still matches. Without this,
    //   the regex bails and the unstripped frontmatter bytes count
    //   toward the 200-char threshold, letting a stub slip past.
    // `\r?\n` throughout accommodates CRLF line endings on Windows
    // checkouts (same rationale).
    const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*(?:\r?\n|$)/, '');
    if (stripped.trim().length < MIN_WHY_CONTENT_CHARS) {
      stubs.push({
        command: entry.command,
        whyPath: entry.whyPath,
        chars: stripped.trim().length,
      });
    }
  }

  return { totalTools: registry.length, missing, stubs };
}

export interface CheckAuditToolDocsOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Output only the JSONL audit-summary line (for the audit-aggregator). */
  summary?: boolean;
  /**
   * @internal Canary-test seam.
   *
   * Override the registry being checked. Canary tests pass a synthetic
   * registry pointing at fixture WHY.md files (some valid, some missing/stub)
   * so the guard's detection behavior can be validated without touching the
   * real registry. Production callers should omit.
   */
  registry?: readonly AuditToolEntry[];
}

/**
 * CLI entry point. Prints findings in human-readable form (or JSONL
 * summary line in `--summary` mode) and exits non-zero on any findings.
 *
 * Async for signature stability if registry validation later needs
 * streaming I/O or async file checks. Same reason as `checkProposalOrphans`.
 */
export async function checkAuditToolDocs(options: CheckAuditToolDocsOptions = {}): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const { totalTools, missing, stubs } = checkAuditToolDocsFromRegistry(repoRoot, options.registry);
  const totalFindings = missing.length + stubs.length;

  if (options.summary) {
    emitSummary({
      tool: 'guard:audit-tool-docs',
      status: totalFindings > 0 ? 'fail' : 'ok',
      findings: totalFindings,
      baseline: 0,
    });
    if (totalFindings > 0) {
      process.exit(1);
    }
    return;
  }

  console.log(`\n🔍 Checking ${totalTools} audit tools for WHY.md docs...\n`);

  if (totalFindings === 0) {
    console.log(`✅ All ${totalTools} audit tools have non-stub WHY.md files.\n`);
    return;
  }

  if (missing.length > 0) {
    console.log(`❌ Missing WHY.md for ${missing.length} audit tool(s):\n`);
    for (const entry of missing) {
      console.log(`   ${entry.command} → ${entry.whyPath}`);
    }
    console.log();
  }

  if (stubs.length > 0) {
    console.log(
      `❌ Stub WHY.md (below ${MIN_WHY_CONTENT_CHARS} chars) for ${stubs.length} audit tool(s):\n`
    );
    for (const entry of stubs) {
      console.log(`   ${entry.command} → ${entry.whyPath} (${entry.chars} chars)`);
    }
    console.log();
  }

  console.log(`Every audit tool listed in \`AUDIT_TOOL_REGISTRY\` must have a non-stub
WHY.md at its registered path. The WHY.md is the decay-zone prompt for
when a Layer-5 cron reminder fires and the operator has to decide whether
to keep or delete the tool. An empty or stub file defeats that purpose.

Fix one of:
  - Write the WHY.md following the template in
    \`docs/proposals/backlog/periodic-audit-enforcement.md\` Layer 2
  - Remove the tool from \`AUDIT_TOOL_REGISTRY\` if it's been deleted
  - Move the file if you changed its location (and update the registry entry)
`);
  process.exit(1);
}
