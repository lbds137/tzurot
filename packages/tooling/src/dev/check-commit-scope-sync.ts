/**
 * Guard: the commit-scope list must not drift across its two prose copies.
 *
 * `allScopes` in `commitlint.config.cjs` is the SOURCE of truth for valid
 * commit scopes — a static root set plus every `packages/`/`services/`
 * directory name (and `tests`), generated at require time. Two markdown
 * surfaces render that set for a human writing a commit:
 *
 *   - `.claude/rules/05-tooling.md`
 *   - `.claude/skills/tzurot-git-workflow/SKILL.md`
 *
 * Both had silently drifted from `allScopes` once already, and nothing
 * enforced that they'd stay in sync — comparing the two copies to
 * each other would have missed it, since they agreed with each other and
 * were both wrong. This guard compares each copy to the SOURCE instead.
 *
 * `commitlint.config.cjs` is required (not text-scraped) to get `allScopes`
 * itself — that reads the live, generated array, immune to reformatting of
 * the config file. The one piece `allScopes` alone can't answer is WHICH
 * entries came from `packages/`/`services/` directory listing rather than
 * the static root set — the merged, sorted array doesn't say. This guard
 * recomputes that split by listing `packages/` and `services/` directly
 * (the same filesystem read `commitlint.config.cjs` performs), never by
 * parsing the config file's source text.
 *
 * Binary sync-check (like guard:monitor-command and guard:duplicate-exports),
 * NOT audit-class: no threshold, no WHY.md, no --summary.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Markdown surfaces carrying a rendered copy of the commit-scope set. */
export const SCOPE_DOC_SURFACES = [
  '.claude/rules/05-tooling.md',
  '.claude/skills/tzurot-git-workflow/SKILL.md',
] as const;

/**
 * Backtick tokens that appear on the `**Scopes:**` line but name the
 * extraction mechanism, not a scope — filtered out before comparison.
 *
 * The workspace-root tokens carry their trailing slash deliberately, so a
 * hypothetical package literally named `packages` or `services` would be
 * compared as a scope rather than silently stripped. The reverse assumption
 * is the one to know about: if the prose is ever reworded to say `packages`
 * without the slash, that token stops being recognized as mechanism and gets
 * reported as an extra scope. That is a loud failure, not a silent one, which
 * is the intended direction — same trade as the zero/multiple `**Scopes:**`
 * line throw below.
 */
const META_TOKENS = new Set(['packages/', 'services/', 'allScopes', 'commitlint.config.cjs']);

export interface SurfaceScopes {
  file: string;
  line: number;
  /** Sorted, deduped scope names found on the line, minus META_TOKENS. */
  scopes: string[];
}

/**
 * Extract the scope names rendered on a surface's `**Scopes:**` line. Throws
 * when a surface carries zero or several such lines — both mean the guard is
 * no longer watching what it claims to (a reworded doc reads as "no drift"
 * otherwise).
 */
export function extractDocScopes(file: string, contents: string): SurfaceScopes {
  const lines = contents.split('\n');
  const matches: number[] = [];
  lines.forEach((raw, i) => {
    if (raw.includes('**Scopes:**')) matches.push(i);
  });

  if (matches.length === 0) {
    throw new Error(
      `${file}: no **Scopes:** line found. If the scope list moved or was reworded, ` +
        'update SCOPE_DOC_SURFACES / the extraction in check-commit-scope-sync.ts.'
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${file}: expected 1 **Scopes:** line, found ${matches.length} ` +
        `(lines ${matches.map(m => m + 1).join(', ')}). Keep one copy per surface.`
    );
  }

  const [lineIdx] = matches;
  const raw = lines[lineIdx];
  const tokens = [...raw.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const scopes = [...new Set(tokens.filter(t => !META_TOKENS.has(t)))].sort();
  return { file, line: lineIdx + 1, scopes };
}

/**
 * The scope names every prose copy must enumerate: everything in `allScopes`
 * that is NOT a generated `packages/`/`services/` directory name. This
 * includes `tests` — it's generated too (conditional on the directory
 * existing), but prose calls it out by name rather than folding it into
 * "every packages/+services/ directory", so it belongs in the expected set.
 */
export function computeExpectedDocScopes(
  allScopes: readonly string[],
  packageDirs: readonly string[],
  serviceDirs: readonly string[]
): string[] {
  const generated = new Set([...packageDirs, ...serviceDirs]);
  return [...new Set(allScopes.filter(s => !generated.has(s)))].sort();
}

export interface ScopeDrift {
  surface: SurfaceScopes;
  /** Expected scopes the surface is missing. */
  missing: string[];
  /** Scopes the surface renders that are not (or no longer) expected. */
  extra: string[];
}

/** Surfaces whose rendered scope set doesn't match the expected set exactly. */
export function findScopeDrift(
  expected: readonly string[],
  surfaces: readonly SurfaceScopes[]
): ScopeDrift[] {
  const expectedSet = new Set(expected);
  const drifted: ScopeDrift[] = [];
  for (const surface of surfaces) {
    const surfaceSet = new Set(surface.scopes);
    const missing = expected.filter(s => !surfaceSet.has(s));
    const extra = surface.scopes.filter(s => !expectedSet.has(s));
    if (missing.length > 0 || extra.length > 0) {
      drifted.push({ surface, missing, extra });
    }
  }
  return drifted;
}

interface CommitlintConfig {
  rules: {
    'scope-enum': [number, string, string[]];
  };
}

/** Read the live, generated `allScopes` array via `require`, not text-scraping. */
export function loadAllScopes(rootDir: string): string[] {
  const req = createRequire(import.meta.url);
  const config = req(join(rootDir, 'commitlint.config.cjs')) as CommitlintConfig;
  return config.rules['scope-enum'][2];
}

function listDirectoryNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch {
    return [];
  }
}

export function checkCommitScopeSync(): void {
  const rootDir = process.cwd();

  let allScopes: string[];
  let surfaces: SurfaceScopes[];
  try {
    allScopes = loadAllScopes(rootDir);
    surfaces = SCOPE_DOC_SURFACES.map(file =>
      extractDocScopes(file, readFileSync(join(rootDir, file), 'utf-8'))
    );
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const packageDirs = listDirectoryNames(join(rootDir, 'packages'));
  const serviceDirs = listDirectoryNames(join(rootDir, 'services'));
  const expected = computeExpectedDocScopes(allScopes, packageDirs, serviceDirs);

  const drifted = findScopeDrift(expected, surfaces);
  if (drifted.length === 0) {
    console.log(
      `✓ Commit-scope prose matches allScopes across ${SCOPE_DOC_SURFACES.length} surfaces.`
    );
    return;
  }

  console.error(
    `❌ Commit-scope prose drifted from allScopes (commitlint.config.cjs) on ` +
      `${drifted.length} surface${drifted.length === 1 ? '' : 's'}.`
  );
  console.error(`\nExpected (non-package/service scopes): ${expected.join(', ')}`);
  for (const { surface, missing, extra } of drifted) {
    console.error(`\n${surface.file}:${surface.line}`);
    if (missing.length > 0) console.error(`  missing: ${missing.join(', ')}`);
    if (extra.length > 0) console.error(`  extra: ${extra.join(', ')}`);
  }
  console.error(
    '\nUpdate the drifted markdown copy to match allScopes in commitlint.config.cjs ' +
      '(the source of truth) — never edit commitlint.config.cjs to match the docs.'
  );
  process.exitCode = 1;
}
