/**
 * Cache Inspector
 *
 * Inspect Turborepo cache size and contents.
 */

import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';

interface CacheStats {
  totalSize: number;
  fileCount: number;
  oldestFile: Date | null;
  newestFile: Date | null;
}

/**
 * Calculate total size of a directory recursively
 */
function getDirStats(dirPath: string): CacheStats {
  const stats: CacheStats = {
    totalSize: 0,
    fileCount: 0,
    oldestFile: null,
    newestFile: null,
  };

  if (!fs.existsSync(dirPath)) {
    return stats;
  }

  const processDir = (currentPath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        processDir(fullPath);
      } else {
        const fileStat = fs.statSync(fullPath);
        stats.totalSize += fileStat.size;
        stats.fileCount++;

        if (stats.oldestFile === null || fileStat.mtime < stats.oldestFile) {
          stats.oldestFile = fileStat.mtime;
        }
        if (stats.newestFile === null || fileStat.mtime > stats.newestFile) {
          stats.newestFile = fileStat.mtime;
        }
      }
    }
  };

  processDir(dirPath);
  return stats;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format date relative to now
 */
function formatRelativeDate(date: Date | null): string {
  if (date === null) return 'N/A';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays} days ago`;
  if (diffHours > 0) return `${diffHours} hours ago`;
  if (diffMins > 0) return `${diffMins} minutes ago`;
  return 'just now';
}

export async function inspectCache(): Promise<void> {
  console.log(chalk.bold('\n📦 Turborepo Cache Inspection\n'));

  const turboDir = path.join(process.cwd(), '.turbo');
  const stats = getDirStats(turboDir);

  if (stats.fileCount === 0) {
    console.log(chalk.yellow('  No cache found. Run a build to populate the cache.'));
    console.log(chalk.dim('  Cache location: .turbo/'));
    return;
  }

  console.log(`  ${chalk.cyan('Location:')}      .turbo/`);
  console.log(`  ${chalk.cyan('Total Size:')}    ${formatBytes(stats.totalSize)}`);
  console.log(`  ${chalk.cyan('Files:')}         ${stats.fileCount}`);
  console.log(`  ${chalk.cyan('Oldest:')}        ${formatRelativeDate(stats.oldestFile)}`);
  console.log(`  ${chalk.cyan('Newest:')}        ${formatRelativeDate(stats.newestFile)}`);

  console.log(chalk.dim('\n  To clear: pnpm ops cache:clear'));
}
