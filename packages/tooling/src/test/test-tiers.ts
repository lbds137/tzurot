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
 * Note what's NOT here: `schema`. A Zod schema test validates a single type's
 * own rules (accepts/rejects the right inputs), which is structurally a *unit*
 * test — it's a plain `*.test.ts`, not a distinct file-kind or tier. Reserve
 * the word "contract" for the bilateral provider↔consumer agreement tier.
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
 * Post-rename the suffixes ARE the tier names (`*.component.test.ts`,
 * `*.integration.test.ts`, `*.contract.test.ts`, plain `*.test.ts` = unit), so
 * classification is a pure suffix check — no directory-location rule. The
 * `matches` description in `TEST_FILE_KIND_INFO` records the rule so the
 * classification stays verifiable.
 */
export const TEST_FILE_KINDS = ['unit', 'component', 'integration', 'contract'] as const;

export type TestFileKind = (typeof TEST_FILE_KINDS)[number];

/** Which canonical tier each file-kind rolls up to. */
export const TIER_FOR_KIND: Readonly<Record<TestFileKind, TestTier>> = {
  unit: 'unit',
  // `*.component.test.ts` boots one whole service in isolation over PGLite —
  // Clemson's "component" tier.
  component: 'component',
  // `*.integration.test.ts` exercises a module against live external deps
  // (real DB+Redis) — Clemson's "integration" tier.
  integration: 'integration',
  // `*.contract.test.ts` verifies a bilateral provider↔consumer agreement.
  contract: 'contract',
};

/** Human-readable mechanical rule that identifies each file-kind. */
export const TEST_FILE_KIND_INFO: Readonly<
  Record<TestFileKind, { tier: TestTier; matches: string }>
> = {
  unit: { tier: 'unit', matches: '*.test.ts (excluding the variants below)' },
  component: { tier: 'component', matches: '*.component.test.ts' },
  integration: { tier: 'integration', matches: '*.integration.test.ts' },
  contract: { tier: 'contract', matches: '*.contract.test.ts' },
};

/**
 * Classify a test file by its repo-relative path. Returns the file-kind, or
 * `null` when the path is not a recognized test file.
 *
 * Order matters: the `.component` / `.integration` / `.contract` variants are
 * all also `.test.ts`, so the specific suffixes must be checked before the
 * bare-unit fallthrough. Classification is a pure suffix check — the suffix
 * carries the tier, so no directory-location rule is needed.
 */
export function classifyTestFile(relPath: string): TestFileKind | null {
  // Normalize Windows separators so the suffix check is platform-stable.
  const p = relPath.replace(/\\/g, '/');
  if (!p.endsWith('.test.ts')) return null;
  if (p.endsWith('.component.test.ts')) return 'component';
  if (p.endsWith('.integration.test.ts')) return 'integration';
  if (p.endsWith('.contract.test.ts')) return 'contract';
  return 'unit';
}
