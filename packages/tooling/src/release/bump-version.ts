/**
 * Bump Version
 *
 * Bump version across all package.json files in the monorepo.
 * Ported from scripts/utils/bump-version.sh
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';

/** Semver with optional pre-release pattern */
const SEMVER_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;

/** Directories to exclude from search */
const EXCLUDED_DIRS = new Set(['node_modules', '.pnpm-store', 'tzurot-legacy', '.git', 'dist']);

export interface BumpVersionOptions {
  dryRun?: boolean;
}

export interface BumpResult {
  file: string;
  oldVersion: string;
  newVersion: string;
  status: 'updated' | 'skipped' | 'no-version';
}

/**
 * Find all package.json files recursively, excluding certain directories
 */
function findPackageJsonFiles(dir: string): string[] {
  const files: string[] = [];

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findPackageJsonFiles(fullPath));
    } else if (entry.name === 'package.json' && entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * Bump version in all package.json files
 */
export async function bumpVersion(
  newVersion: string,
  options: BumpVersionOptions = {}
): Promise<void> {
  const { dryRun = false } = options;

  // Validate version format
  if (!SEMVER_REGEX.test(newVersion)) {
    console.error(chalk.red(`Error: Invalid version format '${newVersion}'`));
    console.error(
      chalk.dim('Expected format: X.Y.Z or X.Y.Z-prerelease (e.g., 3.0.0 or 3.0.0-beta.31)')
    );
    process.exitCode = 1;
    return;
  }

  // Find project root (where we're running from)
  const rootDir = process.cwd();

  // Find all package.json files
  const packageFiles = findPackageJsonFiles(rootDir);

  if (packageFiles.length === 0) {
    console.error(chalk.yellow('No package.json files found'));
    return;
  }

  console.log(chalk.cyan(`${dryRun ? '[DRY RUN] ' : ''}Bumping version to ${newVersion} in:`));
  console.log('');

  const results: BumpResult[] = [];

  for (const file of packageFiles) {
    const relativePath = relative(rootDir, file);

    try {
      const content = readFileSync(file, 'utf-8');
      const pkg = JSON.parse(content) as { version?: string };

      if (!pkg.version) {
        console.log(chalk.dim(`  ${relativePath}: no version field (skipped)`));
        results.push({ file: relativePath, oldVersion: '', newVersion, status: 'no-version' });
        continue;
      }

      if (pkg.version === newVersion) {
        console.log(chalk.dim(`  ${relativePath}: already at ${newVersion} (skipped)`));
        results.push({
          file: relativePath,
          oldVersion: pkg.version,
          newVersion,
          status: 'skipped',
        });
        continue;
      }

      const oldVersion = pkg.version;

      if (!dryRun) {
        // Update version using JSON parse/stringify for safety
        // This avoids regex edge cases with unusual formatting
        const parsed = JSON.parse(content) as Record<string, unknown>;
        parsed.version = newVersion;
        // Preserve 2-space indentation standard in this project
        const updatedContent = JSON.stringify(parsed, null, 2) + '\n';
        writeFileSync(file, updatedContent);
      }

      console.log(chalk.green(`  ${relativePath}: ${oldVersion} -> ${newVersion}`));
      results.push({ file: relativePath, oldVersion, newVersion, status: 'updated' });
    } catch (error) {
      console.error(chalk.red(`  ${relativePath}: failed to process`));
      console.error(chalk.dim(`    ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  console.log('');

  const updated = results.filter(r => r.status === 'updated');
  if (updated.length > 0) {
    console.log(
      chalk.green(`${dryRun ? 'Would update' : 'Updated'} ${updated.length} package.json file(s)`)
    );
    console.log('');
    console.log(chalk.dim('Next steps:'));
    console.log(chalk.dim('  1. Review changes: git diff'));
    console.log(chalk.dim(`  2. Commit: git commit -am "chore: bump version to ${newVersion}"`));
  } else {
    console.log(chalk.yellow('No files needed updating'));
  }
}
