/**
 * Proposal Orphan Check
 *
 * Asserts every `docs/proposals/backlog/*.md` has at least one inbound link
 * from any non-proposal markdown under `backlog/**\/*.md`, `docs/**\/*.md`
 * (excluding `docs/proposals/`), or `CURRENT.md`. Search shape is defined
 * by `SEARCH_ROOTS` and `EXCLUDED_PREFIXES` below.
 *
 * Layer 1 sibling of the canary/golden-fixture pattern (see
 * `docs/proposals/backlog/periodic-audit-enforcement.md`). Same shape: a
 * regular-CI check (NOT cron) that validates the system is being used, not
 * just maintained.
 *
 * Why: proposals that aren't linked from any backlog file rot. The
 * discovery pass that motivated this check found half the existing
 * proposals had zero inbound links — including one that was already-shipped
 * work that should have been deleted long before.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { emitSummary } from './summary.js';

export interface OrphanCheckResult {
  totalProposals: number;
  orphans: string[];
}

const PROPOSALS_GLOB = 'docs/proposals/backlog';
// Search ANY non-proposal markdown for an inbound reference. The failure
// mode this catches is "proposal exists but nothing mentions it" — not
// "proposal isn't mentioned in a specific file." A link from
// docs/research/, docs/incidents/, or docs/README.md all count as "this
// proposal is tracked somewhere a human will see it." `CURRENT.md` and
// `BACKLOG.md` are both root-level work-tracking files per CLAUDE.md;
// either can legitimately host a proposal link.
const SEARCH_ROOTS = ['backlog', 'docs', 'CURRENT.md', 'BACKLOG.md'];
const EXCLUDED_PREFIXES = ['docs/proposals/'];

/**
 * Recursively walk a directory and return all .md files.
 */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Resolve every searchable file (markdown files under the search roots,
 * plus CURRENT.md if present). Used as the haystack for orphan detection.
 */
function collectSearchableFiles(repoRoot: string): string[] {
  const results: string[] = [];
  for (const root of SEARCH_ROOTS) {
    const full = join(repoRoot, root);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (stat.isFile()) {
      results.push(full);
    }
  }
  // Exclude proposals from the haystack — a proposal linking to another
  // proposal doesn't satisfy "this is tracked from somewhere actionable."
  return results.filter(file => {
    const rel = relative(repoRoot, file);
    return !EXCLUDED_PREFIXES.some(prefix => rel.startsWith(prefix));
  });
}

/**
 * Pure orphan check. Returns the list of proposals that lack inbound links.
 * No I/O beyond file reads; no stdout writes; no process.exit. Exported
 * for testing.
 *
 * **Naming assumption**: proposals should use multi-segment kebab-case
 * basenames (`periodic-audit-enforcement.md`, `shapes-inc-fetcher-hardening.md`).
 * The word-boundary regex match treats hyphens as part of the slug, so
 * `memory-leak-fix` won't be rescued by prose mentioning just "memory" —
 * but a hypothetical proposal named `memory.md` WOULD be rescued by any
 * file containing the standalone word "memory." Single-segment common-word
 * basenames defeat the orphan check; multi-segment kebab-case names
 * preserve its precision.
 *
 * @internal
 */
export function findProposalOrphans(repoRoot: string): OrphanCheckResult {
  const proposalsDir = join(repoRoot, PROPOSALS_GLOB);
  const proposals = findMarkdownFiles(proposalsDir);
  const searchableFiles = collectSearchableFiles(repoRoot);

  // Concatenate the haystack once; grepping per-proposal is O(P * H_lines)
  // but for ~15 proposals and a few hundred markdown lines, the simple
  // approach is fine and obvious. The `\n\n` separator is for reader clarity
  // — `\n` would also be safe since the word-boundary regex's character
  // class `[a-zA-Z0-9_-]` doesn't include whitespace, so a slug match can't
  // span a file seam regardless of separator choice.
  const haystack = searchableFiles
    .map(f => {
      try {
        return readFileSync(f, 'utf-8');
      } catch {
        return '';
      }
    })
    .join('\n\n');

  const orphans: string[] = [];
  for (const proposal of proposals) {
    // Match the proposal basename (no .md) as a whole word. A loose
    // substring match would let a proposal named `memory.md` be rescued
    // by any file containing "memory" in prose; the word-boundary form
    // requires the basename to appear as a standalone token — still
    // permissive enough to catch markdown links like `[label](path/foo.md)`
    // or bare mentions like "see foo for context", but not coincidental
    // substring overlap.
    const slug = basename(proposal, '.md');
    // Escape regex metacharacters in the slug (hyphens are common in
    // kebab-case proposal names and are safe, but defensive in case
    // future proposals use other characters).
    //
    // Case-sensitive by intent: proposal slugs are consistently kebab-case
    // in markdown links and prose mentions, and a mixed-case reference like
    // `Periodic-Audit-Enforcement` is not an expected shape. Add the `i`
    // flag here only if a future proposal naming convention diverges.
    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundary = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedSlug}([^a-zA-Z0-9_-]|$)`);
    if (!wordBoundary.test(haystack)) {
      orphans.push(relative(repoRoot, proposal));
    }
  }

  return { totalProposals: proposals.length, orphans };
}

export interface CheckProposalOrphansOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Output only the JSONL audit-summary line (for the audit-aggregator). */
  summary?: boolean;
}

/**
 * CLI entry point. Prints orphans in human-readable form (or JSONL summary
 * line in `--summary` mode) and exits non-zero if any orphans exist.
 *
 * Declared `async` despite no current `await` inside, to keep the
 * signature stable if `findProposalOrphans` later needs streaming file I/O
 * (e.g., glob expansion against a much larger proposals tree). Callers
 * already `await` this, and the lint rule `@typescript-eslint/await-thenable`
 * would flag awaiting a non-Promise return if `async` were dropped.
 */
export async function checkProposalOrphans(
  options: CheckProposalOrphansOptions = {}
): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const { totalProposals, orphans } = findProposalOrphans(repoRoot);

  if (options.summary) {
    emitSummary({
      tool: 'guard:proposal-links',
      status: orphans.length > 0 ? 'fail' : 'ok',
      findings: orphans.length,
      baseline: 0,
    });
    if (orphans.length > 0) {
      process.exit(1);
    }
    return;
  }

  console.log(`\n🔍 Checking ${totalProposals} proposals for inbound links...\n`);

  if (orphans.length === 0) {
    console.log(`✅ All ${totalProposals} proposals have at least one inbound link.`);
    console.log(
      `   Searched: backlog/**/*.md, docs/**/*.md (excluding docs/proposals/), CURRENT.md, BACKLOG.md\n`
    );
    return;
  }

  console.log(`❌ Found ${orphans.length} orphan proposal(s):\n`);
  for (const orphan of orphans) {
    console.log(`   ${orphan}`);
  }
  console.log(`
A proposal is "orphan" when nothing under \`backlog/**/*.md\`,
\`docs/**/*.md\` (excluding \`docs/proposals/\`), \`CURRENT.md\`, or
\`BACKLOG.md\` mentions its basename.

Fix one of:
  - Link the proposal from the appropriate backlog/*.md file (most common)
  - Move it to docs/reference/architecture/ if it's now reference material
  - Delete it if the work shipped or the idea was abandoned
    (git history preserves the proposal text)
`);
  // Non-zero exit signals the CI gate; orphan listings printed above tell
  // the contributor what to fix. Mirrors the summary-mode exit in the
  // earlier branch — both paths fail closed when orphans exist.
  process.exit(1);
}
