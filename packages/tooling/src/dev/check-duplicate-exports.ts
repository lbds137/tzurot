/**
 * Duplicate Export Name Checker
 *
 * Scans each service/package for exported functions, classes, and constants
 * that share the same name across multiple files. Flags potential confusion
 * risks where different files export identically-named symbols.
 *
 * This catches issues that CPD (copy-paste detection) cannot — specifically
 * cases where two files export a function with the same name but different
 * implementations or return types.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';

interface ExportInfo {
  name: string;
  file: string;
  line: number;
  kind: 'function' | 'class' | 'const' | 'reexport';
}

interface DuplicateGroup {
  name: string;
  exports: ExportInfo[];
}

interface CheckOptions {
  verbose?: boolean;
  package?: string;
}

/** Packages to scan */
const PACKAGES = [
  { name: 'api-gateway', path: 'services/api-gateway/src' },
  { name: 'ai-worker', path: 'services/ai-worker/src' },
  { name: 'bot-client', path: 'services/bot-client/src' },
  { name: 'common-types', path: 'packages/common-types/src' },
];

const SEPARATOR = chalk.cyan.bold('═══════════════════════════════════════════════════════');

/** Directories to skip during file discovery */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'generated']);

/**
 * Names that are acceptable to have as duplicates across files.
 * Keyed by package name, or '*' for global allowlist.
 */
const ALLOWLIST: Record<string, Set<string>> = {
  // Handler factory names — common pattern for Express route modules
  '*': new Set([
    'createListHandler',
    'createGetHandler',
    'createCreateHandler',
    'createUpdateHandler',
    'createDeleteHandler',
    'createSetHandler',
    'createClearHandler',
  ]),
  // bot-client command handlers — each command module exports same-named handlers
  // for its domain (character/browse, persona/browse, etc.)
  'bot-client': new Set([
    'handleBrowse',
    'handleButton',
    'handleSelectMenu',
    'handleAutocomplete',
    'execute',
    'data',
    'handleBrowsePagination',
    'handleBrowseSelect',
    'buildBrowseResponse',
    'buildBrowsePage',
    'handleCreate',
    'handleEdit',
    'handleView',
    'handleExport',
    'handleImport',
    'handleTemplate',
    'handleSettings',
    'handleStats',
    'handleModalSubmit',
    'handleSeedModalSubmit',
    'handleBackButton',
    'handleRefreshButton',
    'handleCloseButton',
    'handleDeleteButton',
    'showDetailView',
    'buildDetailEmbed',
    'buildDetailButtons',
    'REQUIRED_IMPORT_FIELDS',
  ]),
};

function isAllowed(name: string, packageName: string): boolean {
  return (ALLOWLIST['*']?.has(name) ?? false) || (ALLOWLIST[packageName]?.has(name) ?? false);
}

/**
 * Check if a file entry should be included in the scan
 */
function isSourceFile(entry: string): boolean {
  return (
    entry.endsWith('.ts') &&
    !entry.endsWith('.test.ts') &&
    !entry.endsWith('.d.ts') &&
    !entry.endsWith('.int.test.ts') &&
    entry !== 'test-utils.ts'
  );
}

/**
 * Find all TypeScript source files in a directory recursively
 */
function findTypeScriptFiles(dir: string): string[] {
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
        files.push(...findTypeScriptFiles(fullPath));
      } else if (isSourceFile(entry)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return files;
}

// NOTE: All patterns are matched per-line. Known limitations:
// - Multi-line `export { ... }` blocks (spanning multiple lines) are not detected
// - `export default function/class` declarations are not tracked (rare in this codebase)
// - `export * from './module'` namespace re-exports are not tracked
// These are acceptable for the intended use case (catching duplicate named exports
// across files), but future maintainers should not assume full coverage.
const EXPORT_PATTERNS: { pattern: RegExp; kind: ExportInfo['kind'] }[] = [
  { pattern: /^export\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
  { pattern: /^export\s+class\s+(\w+)/, kind: 'class' },
  { pattern: /^export\s+const\s+(\w+)\s*=/, kind: 'const' },
];

/** Regex for single-line re-export statements: export { name1, name2 } from '...' */
const REEXPORT_PATTERN = /^export\s*\{([^}]+)\}\s*from\s/;

/**
 * Parse a single re-export name spec (e.g., "name as alias" or just "name")
 */
function parseReExportName(nameSpec: string): string | null {
  const trimmed = nameSpec.trim();
  if (trimmed.startsWith('type ')) {
    return null;
  }
  const asMatch = /(\w+)\s+as\s+(\w+)/.exec(trimmed);
  const name = asMatch !== null ? asMatch[2] : trimmed;
  return name.replace(/^type\s+/, '');
}

/**
 * Extract declaration exports from a single line
 */
function matchDeclarations(line: string, filePath: string, lineNum: number): ExportInfo[] {
  const results: ExportInfo[] = [];
  for (const { pattern, kind } of EXPORT_PATTERNS) {
    const match = line.match(pattern);
    if (match !== null) {
      results.push({ name: match[1], file: filePath, line: lineNum, kind });
    }
  }
  return results;
}

/**
 * Extract re-exports from a single line
 */
function matchReExports(line: string, filePath: string, lineNum: number): ExportInfo[] {
  const reexportMatch = REEXPORT_PATTERN.exec(line);
  if (reexportMatch === null) {
    return [];
  }
  const results: ExportInfo[] = [];
  for (const nameSpec of reexportMatch[1].split(',')) {
    const name = parseReExportName(nameSpec);
    if (name !== null) {
      results.push({ name, file: filePath, line: lineNum, kind: 'reexport' });
    }
  }
  return results;
}

/**
 * Extract exported names from a TypeScript file
 */
function extractExports(filePath: string): ExportInfo[] {
  const results: ExportInfo[] = [];
  const lines = readFileSync(filePath, 'utf-8').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^export\s+(?:type|interface)\s/.test(line)) {
      continue;
    }
    const lineNum = i + 1;
    results.push(...matchDeclarations(line, filePath, lineNum));
    results.push(...matchReExports(line, filePath, lineNum));
  }

  return results;
}

/**
 * Find duplicate export names within a package, filtering out allowlisted
 * names and cases where one definition has re-exports (intentional pattern).
 */
function findDuplicates(allExports: ExportInfo[], packageName: string): DuplicateGroup[] {
  const byName = new Map<string, ExportInfo[]>();
  for (const exp of allExports) {
    const existing = byName.get(exp.name) ?? [];
    existing.push(exp);
    byName.set(exp.name, existing);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [name, exports] of byName) {
    if (exports.length <= 1 || isAllowed(name, packageName)) {
      continue;
    }

    // Skip if all re-exports, or only one actual definition
    const definitions = exports.filter(e => e.kind !== 'reexport');
    if (definitions.length <= 1) {
      continue;
    }

    duplicates.push({ name, exports });
  }

  return duplicates;
}

/**
 * Display duplicates found in a package
 */
function displayPackageDuplicates(
  duplicates: DuplicateGroup[],
  packageName: string,
  rootDir: string
): void {
  console.log(
    chalk.yellow.bold(`\u26a0\ufe0f  ${packageName}: ${duplicates.length} duplicate name(s)`)
  );
  console.log('');

  for (const dup of duplicates) {
    console.log(chalk.white(`  ${dup.name}:`));
    for (const exp of dup.exports) {
      const relPath = relative(rootDir, exp.file);
      const kindBadge = exp.kind === 'reexport' ? chalk.dim(' (re-export)') : '';
      console.log(chalk.dim(`    ${relPath}:${exp.line}`) + kindBadge);
    }
    console.log('');
  }
}

/**
 * Check for duplicate exports across all packages
 */
export async function checkDuplicateExports(options: CheckOptions = {}): Promise<void> {
  const { verbose = false } = options;
  const rootDir = process.cwd();

  console.log(SEPARATOR);
  console.log(chalk.cyan.bold('           DUPLICATE EXPORT NAME CHECK                  '));
  console.log(SEPARATOR);
  console.log('');

  const packagesToCheck =
    options.package !== undefined ? PACKAGES.filter(p => p.name === options.package) : PACKAGES;

  if (packagesToCheck.length === 0) {
    console.log(chalk.red(`Unknown package: ${options.package}`));
    process.exitCode = 1;
    return;
  }

  let totalDuplicates = 0;
  let totalFilesChecked = 0;

  for (const pkg of packagesToCheck) {
    const files = findTypeScriptFiles(join(rootDir, pkg.path));
    totalFilesChecked += files.length;

    if (verbose) {
      console.log(chalk.dim(`Scanning ${pkg.name}: ${files.length} files`));
    }

    const allExports = files.flatMap(extractExports);
    const duplicates = findDuplicates(allExports, pkg.name);

    if (duplicates.length > 0) {
      displayPackageDuplicates(duplicates, pkg.name, rootDir);
      totalDuplicates += duplicates.length;
    } else if (verbose) {
      console.log(chalk.green(`  \u2705 ${pkg.name}: no duplicates\n`));
    }
  }

  console.log(
    chalk.dim(`Checked ${totalFilesChecked} files across ${packagesToCheck.length} package(s)\n`)
  );

  if (totalDuplicates === 0) {
    console.log(chalk.green.bold('\u2705 No duplicate export names found!'));
  } else {
    console.log(chalk.yellow.bold(`Found ${totalDuplicates} duplicate name group(s).`));
    console.log(
      chalk.dim('To allowlist acceptable duplicates, edit ALLOWLIST in check-duplicate-exports.ts')
    );
    process.exitCode = 1;
  }

  console.log('');
  console.log(SEPARATOR);
  console.log(chalk.dim('\ud83d\udca1 Run with --verbose for per-package details'));
  console.log(SEPARATOR);
}
