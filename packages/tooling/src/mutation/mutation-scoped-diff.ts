/**
 * Diff-parsing and planning core for the diff-scoped mutation gate
 * (`ops test:mutation-scoped`, see mutation-scoped.ts for the runner).
 *
 * Pure, fs-and-git-shaped primitives: `git diff --unified=0` text → added or
 * changed line ranges per file → owning workspace package per file → one
 * planned Stryker invocation per package.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** A 1-based, inclusive source line range (the + side of one diff hunk). */
export interface LineRange {
  start: number;
  end: number;
}

/** A diffed source file resolved to its owning workspace package. */
export interface ResolvedFile {
  /** Repo-root-relative path. */
  file: string;
  packageName: string;
  /** Repo-root-relative package directory. */
  packageDir: string;
  ranges: LineRange[];
}

/** One planned Stryker invocation for a single workspace package. */
export interface PackagePlan {
  packageName: string;
  /** Package name without the @tzurot/ scope (report-path segment). */
  shortName: string;
  packageDir: string;
  /** Repo-root-relative files contributing at least one range. */
  files: string[];
  /** Package-relative comma-joined --mutate value: `src/a.ts:1-2,src/b.ts:3-4`. */
  mutateArg: string;
  rangeCount: number;
}

interface OwningPackage {
  name: string;
  dir: string;
  stryker: boolean;
}

interface PackageManifest {
  name?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
// A CLI `-m` list replaces the package config's `mutate` list, so the config's own
// negations (`!src/clients/_generated/**`, `!src/index.ts` — the config files' own
// words) would be bypassed; these repeat them.
const EXCLUDED_SEGMENTS = new Set(['dist', 'generated', '_generated']);
const STRYKER_CORE = '@stryker-mutator/core';

/** Pure: parse `git diff --unified=0` text into added/changed ranges per file. */
export function parseGitDiff(diffText: string): Map<string, LineRange[]> {
  const result = new Map<string, LineRange[]>();
  let currentFile: string | null = null;
  for (const line of diffText.split('\n')) {
    if (line === '+++ /dev/null') {
      currentFile = null;
      continue;
    }
    // git's quoted-path form (`+++ "b/with space.ts"`) is not parsed — harmless under this repo's space-free source naming.
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      continue;
    }
    const match = HUNK_HEADER.exec(line);
    if (match === null || currentFile === null) {
      continue;
    }
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) {
      const ranges = result.get(currentFile) ?? [];
      ranges.push({ start, end: start + count - 1 });
      result.set(currentFile, ranges);
    }
  }
  return result;
}

/**
 * Pure: is this diffed file a mutable source target (ts, non-test,
 * non-declaration, non-generated)?
 * With `packageDir`, also excludes the package's top-level barrel `src/index.ts`
 * (exact package-relative path only — `src/commands/index.ts` stays mutable).
 */
export function isMutationTarget(file: string, packageDir?: string): boolean {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) {
    return false;
  }
  if (file.split('/').some(segment => EXCLUDED_SEGMENTS.has(segment))) {
    return false;
  }
  if (packageDir !== undefined && relative(packageDir, file) === 'src/index.ts') {
    return false;
  }
  return true;
}

/** Nearest-ancestor package.json → { name, dir, stryker }; null when none parses. */
export function resolveOwningPackage(repoRoot: string, file: string): OwningPackage | null {
  let dir = dirname(join(repoRoot, file));
  for (;;) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const pkg = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageManifest;
        if (typeof pkg.name !== 'string') {
          return null;
        }
        const stryker =
          pkg.dependencies?.[STRYKER_CORE] !== undefined ||
          pkg.devDependencies?.[STRYKER_CORE] !== undefined;
        return { name: pkg.name, dir: relative(repoRoot, dir), stryker };
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** Pure: group resolved files into one plan per package (deterministic order). */
export function buildPlans(resolved: ResolvedFile[]): PackagePlan[] {
  const byPackage = new Map<string, ResolvedFile[]>();
  for (const entry of resolved) {
    const list = byPackage.get(entry.packageDir) ?? [];
    list.push(entry);
    byPackage.set(entry.packageDir, list);
  }
  const plans: PackagePlan[] = [];
  for (const [packageDir, files] of byPackage) {
    files.sort((a, b) => a.file.localeCompare(b.file));
    const parts: string[] = [];
    for (const entry of files) {
      const relPath = relative(packageDir, entry.file);
      const ranges = [...entry.ranges].sort((a, b) => a.start - b.start);
      for (const range of ranges) {
        parts.push(`${relPath}:${range.start}-${range.end}`);
      }
    }
    plans.push({
      packageName: files[0].packageName,
      shortName: files[0].packageName.replace(/^@tzurot\//, ''),
      packageDir,
      files: files.map(entry => entry.file),
      mutateArg: parts.join(','),
      rangeCount: parts.length,
    });
  }
  return plans.sort((a, b) => a.packageDir.localeCompare(b.packageDir));
}
