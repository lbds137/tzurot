/**
 * Guard: every `tsc`-invoking `build` script must clean first.
 *
 * Turbo cache poisoning: a stale `dist/` + `tsconfig.tsbuildinfo` survives a
 * branch switch, and `tsc` incremental-builds on top of it, producing a build
 * that doesn't match the source. Every TS package's `build` script was
 * converted to `rm -rf dist tsconfig.tsbuildinfo && tsc` to fix this. A new
 * package added with a bare `"build": "tsc"` silently reintroduces the whole
 * class — this guard catches that at CI time.
 *
 * Scope: `packages/*\/package.json` and `services/*\/package.json`.
 * - No `scripts.build` → skip.
 * - `scripts.build` doesn't invoke `tsc` → skip (out of class; `astro build`,
 *   `vite build`, etc. — `services/website` is exempt this way, not by name).
 * - `scripts.build` invokes `tsc` → must begin with the exact clean-first
 *   prefix `rm -rf dist tsconfig.tsbuildinfo && `.
 *
 * The prefix match is a LITERAL string comparison, deliberately: a
 * functionally-equivalent variant (`rm -rf tsconfig.tsbuildinfo dist && `, or
 * an extra space) is reported as a violation. One canonical spelling across the
 * monorepo is what makes the shape greppable and reviewable at a glance, so
 * this guard enforces the convention, not merely "cleans before building."
 *
 * This is a binary sync-check (like guard:duplicate-exports), NOT an
 * audit-class tool: no threshold, no WHY.md, no --summary.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['packages', 'services'] as const;
const REQUIRED_PREFIX = 'rm -rf dist tsconfig.tsbuildinfo && ';

export interface BuildScriptViolation {
  packagePath: string;
  script: string;
}

/**
 * The final path segment of a shell word, once any clinging punctuation is
 * allowed for: `tsc`, `(tsc)`, `"tsc"` all qualify, and so does the last
 * segment of a path-qualified invocation like `./node_modules/.bin/tsc`.
 *
 * Word characters plus `.`, `/` and `-` are excluded from the surrounding
 * classes on purpose: they are part of real command names, and excluding them
 * is what stops `tsc-helper` and `build:tsc` from matching. Anchored at both
 * ends so the match stays linear.
 */
const TSC_WORD = /^[^\w./-]*tsc[^\w./-]*$/;

/**
 * The part of `word` after its last `/` — a path-qualified invocation
 * (`./node_modules/.bin/tsc`, `bin)/tsc`) runs the same compiler as a bare
 * `tsc`, and testing only the final segment is what lets an arbitrary path
 * prefix through without loosening the classes above. `build:tsc` is untouched
 * by this: `:` is not a path separator, so its final segment is the whole word.
 */
function finalPathSegment(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

/**
 * True when `script` contains `tsc` as a whole shell word in any of its
 * `&&`/`||`/`;`/`|`-separated segments.
 *
 * Deliberately word-based rather than "leading word, behind a known runner
 * allowlist": `tsc` reaches the compiler through an open-ended set of wrappers
 * — `npx tsc`, `pnpm exec tsc`, `cross-env FOO=bar tsc`, `dotenv -e .env -- tsc`
 * — and any wrapper an allowlist doesn't name would be skipped silently, which
 * is the exact failure this guard exists to prevent. The tradeoff is a script
 * passing the literal word `tsc` as an argument value (`--compiler tsc`) being
 * flagged; a guard against silent cache poisoning should fail loud.
 *
 * A `tsc` appearing only as a substring (`tsconfig.tsbuildinfo`, `tsc-helper`,
 * `build:tsc`) never matches — the word split is what makes that hold, and both
 * halves are pinned by the tests in the colocated spec. Note that a `\btsc\b`
 * regex would NOT hold that half: `-` and `:` are non-word characters, so it
 * matches inside `tsc-helper` and `build:tsc`.
 */
export function invokesTsc(script: string): boolean {
  const segments = script.split(/&&|\|\||[;|]/);
  return segments.some(segment =>
    segment.split(/\s+/).some(word => TSC_WORD.test(finalPathSegment(word)))
  );
}

/**
 * Read one package's `package.json` and return its violation, if any — `null`
 * when the file is missing/unreadable, has no `build` script, the `build`
 * script doesn't invoke `tsc`, or it already carries the required prefix.
 */
function checkPackageJson(pkgJsonPath: string): BuildScriptViolation | null {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(pkgJsonPath);
  } catch {
    return null; // no package.json (not a package dir)
  }
  if (!stat.isFile()) return null;

  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
  } catch {
    return null; // unreadable/invalid JSON — not this guard's concern
  }

  const build: unknown = parsed.scripts?.build;
  // A syntactically-valid package.json can still carry a non-string `build`
  // (`null`, a number). Without this, invokesTsc would call .split on it and
  // take the whole guard down — a crash where the JSON-parse failure above
  // degrades to a skip.
  if (typeof build !== 'string') return null;
  if (!invokesTsc(build)) return null;
  if (build.startsWith(REQUIRED_PREFIX)) return null;

  return { packagePath: pkgJsonPath, script: build };
}

/**
 * Scan every `packages/*\/package.json` and `services/*\/package.json` for a
 * `build` script that invokes `tsc` without the required clean-first prefix.
 *
 * Returned sorted by package path: `readdirSync` order is filesystem-dependent,
 * and the CI failure list should be stable and diffable across reruns.
 */
export function findBuildScriptViolations(rootDir: string): BuildScriptViolation[] {
  const violations: BuildScriptViolation[] = [];
  for (const root of ROOTS) {
    const rootPath = join(rootDir, root);
    let packages: string[];
    try {
      packages = readdirSync(rootPath);
    } catch {
      continue; // root doesn't exist
    }
    for (const pkg of packages) {
      const violation = checkPackageJson(join(rootPath, pkg, 'package.json'));
      if (violation !== null) violations.push(violation);
    }
  }
  return violations.sort((a, b) => a.packagePath.localeCompare(b.packagePath));
}

export function checkBuildScripts(): void {
  const rootDir = process.cwd();
  const violations = findBuildScriptViolations(rootDir);

  if (violations.length === 0) {
    console.log('✓ Every tsc-invoking build script clears dist + tsbuildinfo first.');
    return;
  }

  console.error(
    `❌ ${violations.length} build script${violations.length === 1 ? '' : 's'} invoke tsc without clearing dist + tsbuildinfo first — ` +
      'this reintroduces turbo cache poisoning across a branch switch.'
  );
  for (const v of violations) {
    console.error(`  ${relative(rootDir, v.packagePath)}  build: "${v.script}"`);
  }
  console.error(
    `\nFix: prefix the build script with \`${REQUIRED_PREFIX}\` (exact string, including the trailing "&& ").`
  );
  process.exitCode = 1;
}
