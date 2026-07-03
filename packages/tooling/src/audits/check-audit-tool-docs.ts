/**
 * Audit Tool Documentation Guard
 *
 * Structural enforcement for Layer 2 of the audit-enforcement
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { emitSummary } from './summary.js';
import {
  AUDIT_TOOL_REGISTRY,
  UNREGISTERED_WHY_PATHS,
  type AuditToolEntry,
} from './audit-tool-registry.js';

export interface AuditToolDocsCheckResult {
  totalTools: number;
  /** Tools whose WHY.md file is missing entirely. */
  missing: { command: string; whyPath: string }[];
  /** Tools whose WHY.md exists but is below the content threshold. */
  stubs: { command: string; whyPath: string; chars: number }[];
  /**
   * WHY.md files found in the tooling tree that don't correspond to any
   * registered audit tool AND aren't on the `UNREGISTERED_WHY_PATHS`
   * allowlist. The bidirectional check (Layer 3): every registered tool
   * must have a WHY.md AND every WHY.md must be either registered or
   * explicitly allowlisted.
   */
  orphanWhyFiles: string[];
}

/**
 * Where the bidirectional check scans for WHY.md files. Repo-relative.
 * Scoped to the tooling package because that's where audit tools live;
 * a future expansion could broaden this (e.g., to `services/`) if WHY.md
 * adoption spreads.
 */
const WHY_SEARCH_ROOT = 'packages/tooling/src';

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
 * Recursively walk `dir` and return relative paths of every WHY.md file
 * (basenames ending in `.WHY.md` OR a literal `WHY.md` inside a module
 * directory). Uses `withFileTypes: true` for the Dirent's own
 * `isDirectory()` / `isFile()` predicates — no separate `lstatSync`
 * per entry. Dirent does NOT follow symlinks, so symlink cycles are
 * impossible and symlinked WHY.md files are excluded — use a regular
 * file copy if a WHY.md needs to appear in two locations.
 */
function findWhyFiles(repoRoot: string, dir: string): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findWhyFiles(repoRoot, full));
    } else if (entry.isFile() && (entry.name.endsWith('.WHY.md') || entry.name === 'WHY.md')) {
      results.push(relative(repoRoot, full));
    }
  }
  return results;
}

/**
 * Pure check function. Reads each registered tool's WHY.md and classifies
 * it as missing / stub / ok. Also walks the tooling tree for WHY.md files
 * with no registry entry (bidirectional check). No stdout writes; no
 * process.exit. Exported for testing.
 *
 * @param whySearchRoot Override the WHY.md walk root. Canary tests use
 *   a fixture path to scope the orphan sweep to deliberate fixtures.
 *   Production callers should omit (defaults to `packages/tooling/src`).
 * @param unregisteredWhyPaths Override the allowlist of WHY.md paths that
 *   are intentionally not registered. Canary tests pass an empty array
 *   so the sweep doesn't false-pass on legitimate unregistered files.
 *   Production callers should omit (defaults to `UNREGISTERED_WHY_PATHS`).
 */
export function checkAuditToolDocsFromRegistry(
  repoRoot: string,
  registry: readonly AuditToolEntry[] = AUDIT_TOOL_REGISTRY,
  whySearchRoot: string = WHY_SEARCH_ROOT,
  unregisteredWhyPaths: readonly string[] = UNREGISTERED_WHY_PATHS
): AuditToolDocsCheckResult {
  const missing: AuditToolDocsCheckResult['missing'] = [];
  const stubs: AuditToolDocsCheckResult['stubs'] = [];

  for (const entry of registry) {
    const fullPath = join(repoRoot, entry.whyPath);

    let content: string;
    try {
      // Confirm it's a regular file before reading. A non-file entry
      // (directory accidentally created at the WHY.md path, broken
      // symlink, etc.) gets classified as `missing` — same bucket as
      // a truly-absent file because the operator's fix is the same
      // shape ("get a regular WHY.md file to land at this path,"
      // possibly removing whatever's blocking the path first). The
      // try/catch covers ENOENT directly; no separate existsSync
      // check needed (that would add a TOCTOU window without
      // changing behavior).
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
    // The `[\s\S]*?` is intentionally lazy (rather than greedy). The
    // failure mode of a lazy match is a *false pass* — if a YAML scalar
    // happened to contain an embedded `---` line, the regex would treat
    // it as the closing fence and the post-fence content would count
    // toward the threshold (more bytes survive the strip → a stub might
    // exceed the floor). The failure mode of a greedy match would be a
    // *false fail* — if a WHY.md body contained `---` (e.g., a horizontal
    // rule), the regex would strip past it and undercount the body.
    // The current WHY.md format doesn't use YAML block scalars or body
    // horizontal rules, so neither shape bites today; the lazy choice
    // errs toward "let unusual files pass" rather than "fail surprisingly."
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

  // Bidirectional check: walk the tooling tree for WHY.md files that
  // aren't registered AND aren't on the allowlist. Catches the failure
  // mode where a tool gets removed from the registry but its WHY.md
  // stays behind — knip can't detect this (paths are data, not imports).
  const registeredPaths = new Set(registry.map(e => e.whyPath));
  const allowlistedPaths = new Set(unregisteredWhyPaths);
  const allWhyFiles = findWhyFiles(repoRoot, join(repoRoot, whySearchRoot));
  const orphanWhyFiles = allWhyFiles.filter(
    path => !registeredPaths.has(path) && !allowlistedPaths.has(path)
  );

  return { totalTools: registry.length, missing, stubs, orphanWhyFiles };
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
  /**
   * @internal Canary-test seam.
   *
   * Override the WHY.md search root for the bidirectional orphan sweep.
   * Production callers should omit (defaults to `packages/tooling/src`).
   */
  whySearchRoot?: string;
  /**
   * @internal Canary-test seam.
   *
   * Override the allowlist of intentionally-unregistered WHY.md paths.
   * Production callers should omit (defaults to `UNREGISTERED_WHY_PATHS`).
   */
  unregisteredWhyPaths?: readonly string[];
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
  const { totalTools, missing, stubs, orphanWhyFiles } = checkAuditToolDocsFromRegistry(
    repoRoot,
    options.registry,
    options.whySearchRoot,
    options.unregisteredWhyPaths
  );
  const totalFindings = missing.length + stubs.length + orphanWhyFiles.length;

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
    console.log(`✅ All ${totalTools} audit tools have non-stub WHY.md files.`);
    console.log(`   No orphan WHY.md files in the tooling tree.\n`);
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

  if (orphanWhyFiles.length > 0) {
    console.log(`❌ Found ${orphanWhyFiles.length} orphan WHY.md file(s) (no registry entry):\n`);
    for (const path of orphanWhyFiles) {
      console.log(`   ${path}`);
    }
    console.log();
  }

  console.log(`Every audit tool listed in \`AUDIT_TOOL_REGISTRY\` must have a non-stub
WHY.md at its registered path. AND every WHY.md file in the tooling tree
must either correspond to a registered audit tool OR appear in the
\`UNREGISTERED_WHY_PATHS\` allowlist (for operator-tool docs that
intentionally aren't audit-class).

Fix one of:
  - Write the WHY.md following the template in
    \`docs/reference/audit-enforcement.md\` Layer 2
  - Remove the tool from \`AUDIT_TOOL_REGISTRY\` if it's been deleted
  - Delete the orphan WHY.md if its audit tool no longer exists
  - Add the WHY.md to \`UNREGISTERED_WHY_PATHS\` if it's intentionally
    not an audit tool (e.g., operator-tool documentation)
  - Move the file if you changed its location (and update the registry)
`);
  process.exit(1);
}
