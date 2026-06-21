/**
 * Test-Tier Taxonomy — shared vocabulary
 *
 * The single in-code source of truth for the test tiers Tzurot recognizes,
 * adopted from Toby Clemson's microservice testing taxonomy
 * (martinfowler.com/articles/microservice-testing/). The canonical *prose*
 * lives in `docs/reference/guides/TESTING.md`; this module is the *machine*
 * half of the same contract.
 *
 * Two tools consume it:
 * - `guard:test-taxonomy` asserts TESTING.md documents every tier listed in
 *   `CANONICAL_TEST_TIERS`, so the doc can't silently drop a tier the code
 *   recognizes (or vice-versa). The doc and this constant move together or
 *   CI fails.
 * - `test:tiers` classifies each test file into one of these tiers and prints
 *   the per-package distribution (report-only; the ratchet is a later epic).
 *
 * Why a code constant AND a doc: the doc teaches; the constant enforces. The
 * guard ties them so neither drifts from the other.
 */

/**
 * The five canonical tiers, ordered most-isolated → most-integrated.
 *
 * Note what's NOT here: `schema`. A `*.schema.test.ts` validates a single
 * type's own rules (accepts/rejects the right inputs), which is structurally
 * a *unit* test — not a cross-service contract. It's tracked as a separate
 * file-kind in the report (its suffix makes it countable) but maps to the
 * `unit` tier. Reserve the word "contract" for the bilateral provider↔consumer
 * agreement tier.
 */
export const CANONICAL_TEST_TIERS = [
  'unit',
  'component',
  'integration',
  'contract',
  'e2e',
] as const;

export type TestTier = (typeof CANONICAL_TEST_TIERS)[number];

/**
 * The mechanically-distinguishable kinds of test file. Each is identified by
 * a file-suffix / location rule (see `classifyTestFile`) and maps to exactly
 * one canonical tier (see `TIER_FOR_KIND`).
 *
 * The kind names are deliberately the *tier* names (component, integration,
 * contract) rather than the file suffixes (int, e2e) — surfacing the
 * suffix→tier truth is the whole point of the taxonomy reconciliation. The
 * `matches` description in `TEST_FILE_KIND_INFO` records the mechanical rule
 * so the classification stays verifiable.
 */
export const TEST_FILE_KINDS = ['unit', 'schema', 'component', 'integration', 'contract'] as const;

export type TestFileKind = (typeof TEST_FILE_KINDS)[number];

/** Which canonical tier each file-kind rolls up to. */
export const TIER_FOR_KIND: Readonly<Record<TestFileKind, TestTier>> = {
  unit: 'unit',
  // A schema test validates one type's own rules → unit-tier (NOT a contract).
  schema: 'unit',
  // `*.int.test.ts` boots one whole service in isolation over PGLite — Clemson
  // calls this "component," not "integration." Currently mislabeled by suffix.
  component: 'component',
  // `*.e2e.test.ts` outside contracts/ exercises real DB+Redis — a module
  // against live external deps, which Clemson calls "integration."
  integration: 'integration',
  contract: 'contract',
};

/** Human-readable mechanical rule that identifies each file-kind. */
export const TEST_FILE_KIND_INFO: Readonly<
  Record<TestFileKind, { tier: TestTier; matches: string }>
> = {
  unit: { tier: 'unit', matches: '*.test.ts (excluding the variants below)' },
  schema: { tier: 'unit', matches: '*.schema.test.ts' },
  component: { tier: 'component', matches: '*.int.test.ts' },
  integration: { tier: 'integration', matches: '*.e2e.test.ts outside tests/e2e/contracts/' },
  contract: { tier: 'contract', matches: '*.e2e.test.ts under tests/e2e/contracts/' },
};

/**
 * Classify a test file by its repo-relative path. Returns the file-kind, or
 * `null` when the path is not a recognized test file.
 *
 * Order matters: the `.e2e` / `.int` / `.schema` variants are all also
 * `.test.ts`, so the specific suffixes must be checked before the bare-unit
 * fallthrough. Contract is an e2e test located under `tests/e2e/contracts/`,
 * so the location check refines the e2e branch.
 */
export function classifyTestFile(relPath: string): TestFileKind | null {
  // Normalize Windows separators so the location check is platform-stable.
  const p = relPath.replace(/\\/g, '/');
  if (!p.endsWith('.test.ts')) return null;
  if (p.endsWith('.e2e.test.ts')) {
    return p.includes('tests/e2e/contracts/') ? 'contract' : 'integration';
  }
  if (p.endsWith('.int.test.ts')) return 'component';
  if (p.endsWith('.schema.test.ts')) return 'schema';
  return 'unit';
}
