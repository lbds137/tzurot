/**
 * Shared utilities for command file discovery
 *
 * Both CommandHandler and deployCommands use this to find command entry points
 * using the "Index-or-Root" pattern, avoiding duplicate/inefficient file scanning.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Get command files using the "Index-or-Root" pattern
 *
 * This pattern identifies command entry points:
 * - Root files: commands/ping.ts (direct files in commands directory)
 * - Index files: commands/preset/index.ts (entry points in subdirectories)
 *
 * This skips:
 * - .d.ts type declaration files
 * - Helper files (api.ts, list.ts) in subdirectories
 * - Nested subcommands (global/edit.ts)
 *
 * @param dir - Directory to scan for commands
 * @param isRoot - Whether this is the root commands directory (internal use)
 * @returns Array of file paths to command entry points
 */
export function getCommandFiles(dir: string, isRoot = true): string[] {
  const files: string[] = [];

  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Only recurse one level deep: commands/foo/ but NOT commands/foo/bar/
      // Nested directories (e.g., admin/debug/) are sub-modules, not command entry points
      if (isRoot) {
        files.push(...getCommandFiles(fullPath, false));
      }
    } else if ((item.endsWith('.ts') || item.endsWith('.js')) && !item.endsWith('.d.ts')) {
      // Only include files that are command entry points:
      // - Root level: any .ts/.js file (e.g., commands/ping.ts)
      // - Subdirectory: only index.ts/index.js (e.g., commands/preset/index.ts)
      const isIndexFile = item === 'index.ts' || item === 'index.js';
      if (isRoot || isIndexFile) {
        files.push(fullPath);
      }
      // Silently skip non-index files in subdirectories (helpers, subcommands)
    }
  }

  return files;
}
