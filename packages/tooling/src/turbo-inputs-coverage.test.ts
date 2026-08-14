/**
 * Guards packages/tooling/turbo.json against drifting out of sync with the
 * live-sweep guard tests' scan roots.
 *
 * Several tooling tests read files OUTSIDE this package at runtime; the
 * package-level turbo.json must declare every such tree as a cache input, or
 * an edit in a swept tree passes a local full test run via stale cache hit
 * while CI (always cold) fails — the TASK-507 bug class. This test imports
 * each guard's actual scan-root constant and asserts BOTH cached test tasks
 * declare a covering input glob, so changing a scan root without updating
 * turbo.json fails here instead of silently un-guarding the cache. Asserting
 * both tasks also pins the two glob lists against drifting apart (JSON allows
 * neither comments nor anchors, so the duplication itself is unavoidable).
 *
 * turbo.json also uses `$TURBO_DEFAULT$` for the package's OWN files — broader
 * than the root test task's `src/**`-style list, deliberately: it picks up
 * test-fixtures/ and config files without hand-maintaining a second glob list,
 * and over-invalidation is the safe direction for a guard package.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOOKS_DIR, HUSKY_DIR } from './dev/check-hook-probes-registry.js';
import { MONITOR_COMMAND_SURFACES } from './dev/check-monitor-command.js';
import { SCAN_ROOTS } from './dev/check-prompt-tags.js';
import { SEARCH_ROOTS } from './audits/check-proposal-orphans.js';
import { SCAN_DIRS } from './audits/check-claude-content-refs.js';
import { RAW_CONTENT_ALLOWLIST } from './eslint/raw-content-allowlist.js';
import { BUILDER_IMPORT_ALLOWLIST } from './eslint/builder-import-allowlist.js';
import { COMMANDS_REL_DIR, OUTPUT_REL_PATH } from './codegen/command-types.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Repo-relative paths the live-sweep tests read via inline literals or
 * test-local constants (nothing importable), keyed here by their reader:
 * - check-gate-parity: ci.yml + root package.json
 * - codegen/handler-paths.test.ts: api-gateway route handler sources
 * - topology/coverageTopology.test.ts: api-gateway mechanism test files,
 *   the e2e contract-test directory, and bot-client/ai-worker mechanism
 *   test files (listed explicitly even though other guards' constants
 *   currently require the same roots — this reader's coverage must not
 *   rest on another guard's shrink-only allowlist staying non-empty)
 * - db/protectedIndexRegistries.test.ts: prisma/drift-ignore.json — also read
 *   at module load by db/protectedIndexRegistry.ts itself (the SOURCE, not
 *   just a test), and through it by db/check-migration-safety.ts and
 *   db/inspect-database.ts, so this root gates the checker's own behaviour,
 *   not only a fixture it reads
 */
const INLINE_LITERAL_ROOTS = [
  '.github/workflows/ci.yml',
  'package.json',
  'services/api-gateway/src',
  'services/bot-client/src',
  'services/ai-worker/src',
  'tests/e2e/contracts',
  'prisma/drift-ignore.json',
];

const REQUIRED_ROOTS: readonly string[] = [
  HOOKS_DIR,
  HUSKY_DIR,
  ...MONITOR_COMMAND_SURFACES,
  ...SCAN_ROOTS,
  ...SEARCH_ROOTS,
  ...SCAN_DIRS,
  ...Object.keys(RAW_CONTENT_ALLOWLIST),
  ...Object.keys(BUILDER_IMPORT_ALLOWLIST),
  COMMANDS_REL_DIR,
  OUTPUT_REL_PATH,
  ...INLINE_LITERAL_ROOTS,
];

interface TurboPackageConfig {
  tasks: Record<string, { inputs?: string[] }>;
}

const turboConfig = JSON.parse(
  readFileSync(path.join(packageRoot, 'turbo.json'), 'utf-8')
) as TurboPackageConfig;

/**
 * A glob covers a root when the glob's static prefix (everything before the
 * first wildcard, $TURBO_ROOT$ stripped) equals the root or is an ancestor
 * directory of it — AND the glob's wildcard tail carries no literal filter
 * (e.g. `*.md`), because a suffix-filtered glob only invalidates on matching
 * files, not on ANY change under the root. Deliberately one-directional: a
 * NARROWER glob than the root (e.g. `docs/x/**` for root `docs`) does not
 * count as coverage either.
 */
function coversRoot(glob: string, root: string): boolean {
  let base = glob.replace(/^\$TURBO_ROOT\$\//, '');
  const wildcard = base.indexOf('*');
  if (wildcard !== -1) {
    // Anything in the tail besides wildcards and separators is a filter
    // (an extension or filename fragment) — partial coverage, not coverage.
    const tail = base.slice(wildcard);
    if (/[^*/]/.test(tail)) {
      return false;
    }
    base = base.slice(0, wildcard);
  }
  base = base.replace(/\/$/, '');
  return root === base || root.startsWith(`${base}/`);
}

describe.each(['test', 'test:coverage'])('turbo.json %s inputs', taskName => {
  it('cover every live-swept repo tree the guard tests read', () => {
    const inputs = turboConfig.tasks[taskName]?.inputs ?? [];
    // Only root-relative globs guard cross-package reads; $TURBO_DEFAULT$
    // covers this package's own files.
    const rootGlobs = inputs.filter(g => g.startsWith('$TURBO_ROOT$/'));
    const uncovered = REQUIRED_ROOTS.filter(root => !rootGlobs.some(g => coversRoot(g, root)));
    expect(
      uncovered,
      `turbo.json "${taskName}" inputs miss live-swept roots — add $TURBO_ROOT$ globs`
    ).toEqual([]);
  });
});

describe('coversRoot', () => {
  it('accepts an exact-file glob for that file', () => {
    expect(coversRoot('$TURBO_ROOT$/.github/workflows/ci.yml', '.github/workflows/ci.yml')).toBe(
      true
    );
  });

  it('accepts a directory glob for the directory and its descendants', () => {
    expect(coversRoot('$TURBO_ROOT$/docs/**', 'docs')).toBe(true);
    expect(coversRoot('$TURBO_ROOT$/docs/**', 'docs/reference')).toBe(true);
  });

  it('rejects a narrower glob than the root', () => {
    expect(coversRoot('$TURBO_ROOT$/docs/x/**', 'docs')).toBe(false);
  });

  it('rejects a sibling that merely shares the prefix string', () => {
    expect(coversRoot('$TURBO_ROOT$/docs/**', 'docs-internal')).toBe(false);
  });

  it('rejects a suffix-filtered glob — it only invalidates on matching files', () => {
    expect(coversRoot('$TURBO_ROOT$/docs/**/*.md', 'docs')).toBe(false);
    expect(coversRoot('$TURBO_ROOT$/docs/**/*.md', 'docs/reference')).toBe(false);
  });
});
