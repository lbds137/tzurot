/**
 * Dead File Finder
 *
 * Detects production files that are only referenced by their own colocated
 * tests — dead code that `pnpm knip` misses because test file imports
 * count as "usage."
 *
 * Two-pass approach:
 * 1. Run `knip --production --include files` for candidate unused files
 * 2. Filter out known false positives (test utils, command submodules)
 * 3. Grep-verify remaining candidates have no non-test importers
 */

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

/** Patterns to exclude from knip output (known false positives) */
const EXCLUDE_PATTERNS = [
  /\/test\//, // Test utility directories
  /\/test-utils/, // Test utility files
  /\.mock\.ts$/, // Mock files
  /\/fixtures/, // Test fixtures
  /\/scripts\//, // Standalone scripts
  /\/commands\/[^/]+\/[^/]+\.ts$/, // Command submodules (dynamically loaded)
  /^vitest\./, // Vitest config files
  /^\.[^/]*\.ts$/, // Dotfiles
];

/**
 * Parse knip output to extract file paths.
 * Knip pads output with trailing whitespace, so we strip it.
 */
export function parseKnipOutput(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\S+\.tsx?$/.test(line));
}

/**
 * Filter out known false-positive patterns from knip results.
 */
export function filterFalsePositives(files: string[]): string[] {
  return files.filter(file => !EXCLUDE_PATTERNS.some(pattern => pattern.test(file)));
}

/**
 * Check if a file has any non-test importers using grep.
 * Returns true if the file is imported by at least one non-test file
 * (other than itself).
 *
 * NOTE: Uses basename-only matching, so files sharing a basename
 * (e.g., multiple `types.ts` or `config.ts`) can mask each other.
 * This is acceptable for an advisory tool — the output message
 * already warns users to verify before deleting.
 */
export function hasNonTestImporters(filePath: string, searchDirs: string[]): boolean {
  const name = basename(filePath.replace(/\.tsx?$/, ''));

  try {
    const result = execFileSync(
      'grep',
      [
        '-rl',
        '--include=*.ts',
        '--exclude=*.test.ts',
        '--exclude=*.spec.ts',
        '--exclude=*.int.test.ts',
        `/${name}\\.js['"]`,
        ...searchDirs,
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Filter out the file itself from results
    const importers = result
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line !== filePath);

    return importers.length > 0;
  } catch {
    // grep returns exit code 1 when no matches found
    return false;
  }
}

export interface FindDeadFilesResult {
  /** Files confirmed as dead (no non-test importers) */
  deadFiles: string[];
  /** Total files reported by knip */
  totalKnipHits: number;
  /** Files filtered as known false positives */
  filteredCount: number;
}

/**
 * Find dead production files in the codebase.
 */
export function findDeadFiles(): FindDeadFilesResult {
  // Run knip in production mode
  let knipOutput: string;
  try {
    knipOutput = execFileSync('pnpm', ['knip', '--production', '--include', 'files'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    // knip exits non-zero when it finds unused files
    const err = error as { stdout?: string; stderr?: string };
    knipOutput = (err.stdout ?? '') + (err.stderr ?? '');
  }

  const allFiles = parseKnipOutput(knipOutput);
  const candidates = filterFalsePositives(allFiles);
  const filteredCount = allFiles.length - candidates.length;

  // Second pass: verify each candidate has no non-test importers
  const searchDirs = ['services/', 'packages/'];
  const deadFiles = candidates.filter(file => !hasNonTestImporters(file, searchDirs));

  return { deadFiles, totalKnipHits: allFiles.length, filteredCount };
}

/**
 * Run dead file detection and print results.
 */
export function runFindDeadFiles(): void {
  const { deadFiles, totalKnipHits, filteredCount } = findDeadFiles();

  if (deadFiles.length === 0) {
    if (totalKnipHits === 0) {
      console.log('✅ No unused files detected.');
    } else {
      console.log(
        `✅ No dead files found (${totalKnipHits} knip hits, ${filteredCount} filtered as false positives).`
      );
    }
    return;
  }

  console.log(`⚠️  Found ${deadFiles.length} potentially dead file(s):\n`);
  for (const file of deadFiles) {
    console.log(`  ${file}`);
  }
  console.log('\nVerify each file: check git log and grep for dynamic imports before deleting.');
  console.log(
    'Note: basename-only matching may miss dead files that share names with live ones (e.g., config.ts, types.ts).'
  );
  process.exitCode = 1;
}
