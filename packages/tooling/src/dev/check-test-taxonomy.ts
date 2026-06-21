/**
 * Test-Tier Taxonomy Drift Guard
 *
 * A binary "is the taxonomy single-sourced?" check — the same class as
 * `guard:duplicate-exports` / `guard:dockerfile-dist` (sync-check, NOT an
 * audit-class measurement, so no WHY.md / canary / baseline).
 *
 * Why this exists: the test-tier taxonomy drifted into three conflicting
 * definitions across `docs/reference/guides/TESTING.md`, the always-loaded
 * rule, and the testing skill — the always-loaded rule carried the thinnest
 * model, which steered a whole epic's coverage decisions. The fix made
 * TESTING.md the single source of truth; the rule + skill carry a one-liner
 * and a link, not a competing table. This guard locks that contract so the
 * docs can't silently re-fork:
 *
 * 1. TESTING.md must carry the canonical tier block (marked) AND document
 *    every tier in `CANONICAL_TEST_TIERS` — so the doc and the in-code
 *    constant move together.
 * 2. The rule + skill must each link to the canonical block — so the
 *    single-source pointer can't be quietly dropped.
 *
 * It does NOT try to detect a *competing* redefinition (that's heuristic and
 * belongs to the broader tier-coverage audit epic). Catching the dropped
 * pointer and the undocumented tier covers the two ways the drift actually
 * recurred.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL_TEST_TIERS } from '../test/test-tiers.js';

/** Repo-relative path to the canonical-taxonomy doc (the single source). */
const CANONICAL_DOC = 'docs/reference/guides/TESTING.md';

/**
 * Repo-relative paths that must point at the canonical block instead of
 * re-defining the tiers. The always-loaded rule and the testing skill are
 * the two places the thin/competing definitions lived.
 */
const POINTER_FILES = [
  '.claude/rules/02-code-standards.md',
  '.claude/skills/tzurot-testing/SKILL.md',
];

/** Markers delimiting the canonical tier block inside the canonical doc. */
const BLOCK_START = '<!-- canonical-test-tiers:start -->';
const BLOCK_END = '<!-- canonical-test-tiers:end -->';

/**
 * The link token a pointer file must contain. Matches the GitHub anchor that
 * the canonical doc's `## Test Tier Taxonomy` heading generates. A bare
 * `TESTING.md` link elsewhere in the file won't satisfy it — the anchor ties
 * the pointer specifically to the taxonomy section.
 */
const POINTER_TOKEN = 'TESTING.md#test-tier-taxonomy';

export interface TaxonomyFinding {
  file: string;
  problem: string;
}

export interface TaxonomyCheckResult {
  findings: TaxonomyFinding[];
}

export interface CheckTestTaxonomyOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** @internal Test seam — override the canonical-doc path. */
  canonicalPath?: string;
  /** @internal Test seam — override the pointer-file paths. */
  pointerPaths?: readonly string[];
  /** @internal Test seam — override the expected tier list. */
  tiers?: readonly string[];
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/** Extract the canonical block body, or `null` if either marker is missing. */
function extractBlock(content: string): string | null {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(start + BLOCK_START.length, end);
}

/**
 * Findings for the canonical doc: it must exist, carry the marked block, and
 * document every tier. Early returns keep each failure mutually exclusive
 * (no block → can't check tiers).
 */
function collectCanonicalFindings(
  repoRoot: string,
  canonicalPath: string,
  tiers: readonly string[]
): TaxonomyFinding[] {
  const canonical = readOrNull(join(repoRoot, canonicalPath));
  if (canonical === null) {
    return [{ file: canonicalPath, problem: 'canonical taxonomy doc not found' }];
  }
  const block = extractBlock(canonical);
  if (block === null) {
    return [
      {
        file: canonicalPath,
        problem: `canonical tier block markers (${BLOCK_START} … ${BLOCK_END}) not found`,
      },
    ];
  }
  // Word-boundary, case-insensitive: `e2e`/`E2E` both match; avoids a
  // substring false-positive inside a larger word.
  return tiers
    .filter(tier => !new RegExp(`\\b${tier}\\b`, 'i').test(block))
    .map(tier => ({
      file: canonicalPath,
      problem: `canonical tier block omits the "${tier}" tier`,
    }));
}

/** Findings for the pointer files: each must exist and link to the block. */
function collectPointerFindings(
  repoRoot: string,
  pointerPaths: readonly string[]
): TaxonomyFinding[] {
  const findings: TaxonomyFinding[] = [];
  for (const pointerPath of pointerPaths) {
    const content = readOrNull(join(repoRoot, pointerPath));
    if (content === null) {
      findings.push({ file: pointerPath, problem: 'pointer file not found' });
    } else if (!content.includes(POINTER_TOKEN)) {
      findings.push({
        file: pointerPath,
        problem: `missing link to the canonical taxonomy (expected a reference to \`${POINTER_TOKEN}\`)`,
      });
    }
  }
  return findings;
}

/**
 * Run the taxonomy drift check. Pure over its inputs (reads files, returns
 * findings) so the CLI wrapper owns all printing/exit. Exported for testing.
 */
export function checkTestTaxonomy(options: CheckTestTaxonomyOptions = {}): TaxonomyCheckResult {
  const repoRoot = options.repoRoot ?? process.cwd();
  return {
    findings: [
      ...collectCanonicalFindings(
        repoRoot,
        options.canonicalPath ?? CANONICAL_DOC,
        options.tiers ?? CANONICAL_TEST_TIERS
      ),
      ...collectPointerFindings(repoRoot, options.pointerPaths ?? POINTER_FILES),
    ],
  };
}

/**
 * CLI entry point. Prints findings and exits non-zero on any drift.
 */
export async function checkTestTaxonomyCommand(
  options: CheckTestTaxonomyOptions = {}
): Promise<void> {
  const { findings } = checkTestTaxonomy(options);

  console.log('\n🔍 Checking test-tier taxonomy is single-sourced...\n');

  if (findings.length === 0) {
    console.log(`✅ Taxonomy is single-sourced in ${CANONICAL_DOC}.`);
    console.log(`   Both pointer files link to it; all tiers documented.\n`);
    return;
  }

  console.log(`❌ Found ${findings.length} taxonomy drift issue(s):\n`);
  for (const finding of findings) {
    console.log(`   ${finding.file}  → ${finding.problem}`);
  }
  console.log();
  console.log(`The test-tier taxonomy must stay single-sourced in ${CANONICAL_DOC}.
Fix one of:
  - Restore the canonical tier block + all tiers in ${CANONICAL_DOC}
  - Re-add the \`${POINTER_TOKEN}\` link in the rule/skill (don't re-define the tiers there)
  - If you intentionally renamed a tier, update CANONICAL_TEST_TIERS and the doc together
`);
  process.exitCode = 1;
}
