/**
 * Guards the root turbo.json `lint` task against losing its ordering edge to
 * the builds whose artifacts the root ESLint config imports.
 *
 * `eslint.config.js` statically imports `packages/tooling/dist/eslint/index.js`
 * — a BUILD OUTPUT of `@tzurot/tooling`. Every package's lint task loads that
 * config, so every lint task depends on that build. turbo cannot infer this:
 * `dependsOn: ["^build"]` means the builds of a package's own DEPENDENCIES, and
 * most packages here do not depend on @tzurot/tooling at all (bot-client's lint
 * graph contained no tooling#build node whatsoever before the edge was added).
 * With no edge, turbo is free to schedule a lint concurrently with that build,
 * and lint reads a dist that is mid-restore or not yet written.
 *
 * The requirement is DERIVED, not hardcoded: this test re-reads the config's
 * imports each run, so removing the import removes the requirement, and adding
 * a second dist-importing plugin demands its own edge instead of silently
 * reintroducing the race.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface TurboRootConfig {
  tasks: Record<string, { dependsOn?: string[] }>;
}

/**
 * Workspace package names whose `dist/` the given source statically imports
 * from, resolved through each package's own package.json so the edge is named
 * the way turbo names it (`@tzurot/tooling#build`), never guessed from the
 * directory.
 *
 * Two boundaries on what this detects, stated because a guard that silently
 * covers less than it appears to is worse than no guard:
 *
 * - It matches **single-quoted static `from '...'` imports only**. Double
 *   quotes are a non-issue — `.prettierrc` sets `singleQuote: true`, so the
 *   formatter normalizes them before this ever runs — but a dynamic
 *   `import('./packages/x/dist/y.js')` would evade it and leave that edge
 *   unguarded while this test still passed. Extend the pattern if one appears.
 * - It assumes the directory above `/dist/` is a package root holding a
 *   `package.json`. True for every dist-importing plugin here, and a violation
 *   fails loudly with ENOENT rather than misattributing the edge, so it is
 *   left as an assumption rather than a check.
 */
function distImportingPackages(source: string, root: string): string[] {
  const names = new Set<string>();
  for (const [, spec] of source.matchAll(/from\s+'(\.\/[^']*?\/dist\/[^']*)'/g)) {
    const pkgDir = spec.slice('./'.length, spec.indexOf('/dist/'));
    const manifest = JSON.parse(readFileSync(path.join(root, pkgDir, 'package.json'), 'utf-8')) as {
      name: string;
    };
    names.add(manifest.name);
  }
  return [...names];
}

describe('root turbo.json lint task', () => {
  const eslintConfig = readFileSync(path.join(repoRoot, 'eslint.config.js'), 'utf-8');
  const turboConfig = JSON.parse(
    readFileSync(path.join(repoRoot, 'turbo.json'), 'utf-8')
  ) as TurboRootConfig;

  it('depends on the build of every package whose dist the root ESLint config imports', () => {
    const required = distImportingPackages(eslintConfig, repoRoot).map(name => `${name}#build`);
    const dependsOn = turboConfig.tasks['lint']?.dependsOn ?? [];
    const missing = required.filter(edge => !dependsOn.includes(edge));
    expect(
      missing,
      "eslint.config.js imports these packages' build outputs, so turbo must order " +
        'lint after them — add the explicit "<pkg>#build" edge to turbo.json "lint".dependsOn'
    ).toEqual([]);
  });

  it('finds the tooling plugin import — the positive control for the extraction', () => {
    // Without this, a regex that matches nothing would report every edge
    // satisfied and the guard above would pass while guarding nothing.
    expect(distImportingPackages(eslintConfig, repoRoot)).toContain('@tzurot/tooling');
  });
});

describe('distImportingPackages', () => {
  it('ignores imports that do not reach into a dist tree', () => {
    expect(distImportingPackages("import x from './packages/tooling/src/x.js';", repoRoot)).toEqual(
      []
    );
  });

  it('ignores bare package specifiers', () => {
    expect(distImportingPackages("import x from '@tzurot/tooling/dist/x.js';", repoRoot)).toEqual(
      []
    );
  });

  it('deduplicates two imports from the same package', () => {
    const source = [
      "import a from './packages/tooling/dist/eslint/index.js';",
      "import b from './packages/tooling/dist/codegen/index.js';",
    ].join('\n');
    expect(distImportingPackages(source, repoRoot)).toEqual(['@tzurot/tooling']);
  });
});
