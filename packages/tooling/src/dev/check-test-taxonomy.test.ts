/**
 * Tests for the test-tier taxonomy drift guard.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkTestTaxonomy } from './check-test-taxonomy.js';

function withTempRepo<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'test-taxonomy-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffold(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

const CANONICAL_PATH = 'docs/TESTING.md';
const POINTER_A = 'rule.md';
const POINTER_B = 'skill.md';

/** A canonical doc whose block documents every tier passed to the check. */
function canonicalDoc(tiers: string[]): string {
  return `## Test Tier Taxonomy

<!-- canonical-test-tiers:start -->
${tiers.map(t => `- **${t}** — description of the ${t} tier`).join('\n')}
<!-- canonical-test-tiers:end -->
`;
}

const POINTER_LINK = 'See [the canonical taxonomy](../docs/TESTING.md#test-tier-taxonomy).';

const OPTS = {
  canonicalPath: CANONICAL_PATH,
  pointerPaths: [POINTER_A, POINTER_B],
  tiers: ['unit', 'component', 'integration', 'contract', 'e2e'],
} as const;

describe('checkTestTaxonomy', () => {
  it('passes when the doc documents every tier and both pointers link to it', () => {
    withTempRepo(root => {
      scaffold(root, {
        [CANONICAL_PATH]: canonicalDoc([...OPTS.tiers]),
        [POINTER_A]: `# Rule\n${POINTER_LINK}\n`,
        [POINTER_B]: `# Skill\n${POINTER_LINK}\n`,
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings).toEqual([]);
    });
  });

  it('flags a missing canonical doc', () => {
    withTempRepo(root => {
      scaffold(root, {
        [POINTER_A]: POINTER_LINK,
        [POINTER_B]: POINTER_LINK,
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings).toContainEqual({
        file: CANONICAL_PATH,
        problem: 'canonical taxonomy doc not found',
      });
    });
  });

  it('flags missing block markers', () => {
    withTempRepo(root => {
      scaffold(root, {
        [CANONICAL_PATH]: '## Test Tier Taxonomy\n\nunit component integration contract e2e\n',
        [POINTER_A]: POINTER_LINK,
        [POINTER_B]: POINTER_LINK,
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings.some(f => f.problem.includes('canonical tier block markers'))).toBe(true);
    });
  });

  it('flags a tier omitted from the canonical block', () => {
    withTempRepo(root => {
      // Block documents only four of the five tiers — "contract" is missing.
      scaffold(root, {
        [CANONICAL_PATH]: canonicalDoc(['unit', 'component', 'integration', 'e2e']),
        [POINTER_A]: POINTER_LINK,
        [POINTER_B]: POINTER_LINK,
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings).toContainEqual({
        file: CANONICAL_PATH,
        problem: 'canonical tier block omits the "contract" tier',
      });
    });
  });

  it('matches tiers case-insensitively (E2E satisfies e2e)', () => {
    withTempRepo(root => {
      scaffold(root, {
        [CANONICAL_PATH]: canonicalDoc(['unit', 'component', 'integration', 'contract', 'E2E']),
        [POINTER_A]: POINTER_LINK,
        [POINTER_B]: POINTER_LINK,
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings).toEqual([]);
    });
  });

  it('flags a pointer file that lacks the canonical link', () => {
    withTempRepo(root => {
      scaffold(root, {
        [CANONICAL_PATH]: canonicalDoc([...OPTS.tiers]),
        [POINTER_A]: POINTER_LINK,
        // POINTER_B links TESTING.md but WITHOUT the taxonomy anchor — must fail.
        [POINTER_B]: 'See [testing](../docs/TESTING.md) for general guidance.',
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings).toContainEqual({
        file: POINTER_B,
        problem:
          'missing link to the canonical taxonomy (expected a reference to `TESTING.md#test-tier-taxonomy`)',
      });
    });
  });

  it('flags a missing pointer file', () => {
    withTempRepo(root => {
      scaffold(root, {
        [CANONICAL_PATH]: canonicalDoc([...OPTS.tiers]),
        [POINTER_A]: POINTER_LINK,
        // POINTER_B not created.
      });
      const { findings } = checkTestTaxonomy({ repoRoot: root, ...OPTS });
      expect(findings).toContainEqual({ file: POINTER_B, problem: 'pointer file not found' });
    });
  });
});
