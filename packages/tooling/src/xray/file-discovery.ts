/**
 * Xray — File Discovery
 *
 * Discovers TypeScript source files across monorepo packages.
 * Reuses the recursive walk pattern from check-boundaries.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { XrayOptions } from './types.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '__mocks__']);

interface DiscoveredPackage {
  name: string;
  srcDir: string;
}

export interface DiscoveryResult {
  name: string;
  srcDir: string;
  files: string[];
}

/**
 * Find all monorepo packages (services/* and packages/*) that have a src/ dir.
 */
function discoverPackages(rootDir: string): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = [];

  for (const topDir of ['services', 'packages']) {
    const parentDir = join(rootDir, topDir);
    try {
      const entries = readdirSync(parentDir);
      for (const entry of entries) {
        const srcDir = join(parentDir, entry, 'src');
        try {
          const stat = statSync(srcDir);
          if (stat.isDirectory()) {
            packages.push({ name: entry, srcDir });
          }
        } catch {
          // No src/ dir — skip
        }
      }
    } catch {
      // Top-level dir doesn't exist — skip
    }
  }

  return packages;
}

/**
 * Recursively find TypeScript files in a directory.
 */
function findTypeScriptFiles(dir: string, includeTests: boolean): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...findTypeScriptFiles(fullPath, includeTests));
      } else if (isTypeScriptSource(entry, includeTests)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return files;
}

function isTypeScriptSource(filename: string, includeTests: boolean): boolean {
  if (!filename.endsWith('.ts')) return false;
  if (filename.endsWith('.d.ts')) return false;
  if (!includeTests && (filename.endsWith('.test.ts') || filename.endsWith('.int.test.ts'))) {
    return false;
  }
  return true;
}

/**
 * Discover packages and their TypeScript source files.
 *
 * @param rootDir - Monorepo root directory
 * @param options - Filter options
 * @returns Array of packages with their source files
 */
export function discoverFiles(
  rootDir: string,
  options: Pick<XrayOptions, 'packages' | 'includeTests'> = {}
): DiscoveryResult[] {
  const { packages: filterPackages, includeTests = false } = options;

  const allPackages = discoverPackages(rootDir);

  const filtered =
    filterPackages !== undefined && filterPackages.length > 0
      ? allPackages.filter(p => filterPackages.includes(p.name))
      : allPackages;

  const results: DiscoveryResult[] = [];

  for (const pkg of filtered) {
    const files = findTypeScriptFiles(pkg.srcDir, includeTests).sort();
    if (files.length > 0) {
      results.push({
        name: pkg.name,
        srcDir: pkg.srcDir,
        files,
      });
    }
  }

  // Sort by name for consistent output: packages/* before services/* (alphabetical)
  return results.sort((a, b) => {
    const aBase = basename(join(a.srcDir, '..'));
    const bBase = basename(join(b.srcDir, '..'));
    if (aBase !== bBase) return aBase.localeCompare(bBase);
    return a.name.localeCompare(b.name);
  });
}
