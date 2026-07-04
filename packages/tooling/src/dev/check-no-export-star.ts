/**
 * Guard: no `export *` barrels in production source.
 *
 * `export * from '…'` re-exports MASK knip's dead-export detection — knip can't
 * trace which star-re-exported symbols are consumed, so it treats them all as
 * used, and unused exports silently accumulate behind the barrel. The barrel-kill
 * epic converted every barrel to explicit `export { A, type B } from '…'` (which
 * knip CAN trace); this guard keeps it that way. A single new `export *` in
 * production source re-masks the whole dead-export gate for that subtree.
 *
 * Exempt: generated code (`generated/`, `_generated/`) and test infrastructure
 * (`__mocks__/`, `test/mocks/`, `test/fixtures/`) — those aren't part of the
 * dead-export surface knip audits.
 *
 * This is a binary sync-check (like guard:duplicate-exports), NOT an audit-class
 * tool: no threshold, no WHY.md, no --summary.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['packages', 'services'] as const;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
/** Files under these path segments aren't part of the dead-export surface. */
const EXEMPT_PATH = /\/(generated|_generated|__mocks__)\/|\/test\/(mocks|fixtures)\//;
const STAR_EXPORT = /^\s*export\s+\*\s+from\s+['"]/;

export interface StarExportViolation {
  filePath: string;
  line: number;
  text: string;
}

/** A scanned production source file: `.ts`, not a test/declaration file, not exempt. */
export function isScannedSourceFile(filePath: string): boolean {
  return (
    filePath.endsWith('.ts') &&
    !filePath.endsWith('.test.ts') &&
    !filePath.endsWith('.spec.ts') &&
    !filePath.endsWith('.d.ts') &&
    !EXEMPT_PATH.test(filePath)
  );
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist / not readable
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (isScannedSourceFile(full)) {
      out.push(full);
    }
  }
}

/** Find every `export * from '…'` in production source across the monorepo. */
export function findStarExports(rootDir: string): StarExportViolation[] {
  const violations: StarExportViolation[] = [];
  for (const root of ROOTS) {
    const files: string[] = [];
    walk(join(rootDir, root), files);
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (STAR_EXPORT.test(line)) {
          violations.push({ filePath: file, line: i + 1, text: line.trim() });
        }
      });
    }
  }
  return violations;
}

export function checkNoExportStar(): void {
  const rootDir = process.cwd();
  const violations = findStarExports(rootDir);

  if (violations.length === 0) {
    console.log('✓ No `export *` barrels in production source.');
    return;
  }

  console.error(
    `❌ ${violations.length} \`export *\` re-export${violations.length === 1 ? '' : 's'} found — ` +
      "these re-mask knip's dead-export detection."
  );
  for (const v of violations) {
    console.error(`  ${relative(rootDir, v.filePath)}:${v.line}  ${v.text}`);
  }
  console.error(
    "\nUse explicit `export { A, type B } from './x.js'` so knip can trace the " +
      're-exports (barrel-kill epic). Generated code + test mocks/fixtures are exempt.'
  );
  process.exitCode = 1;
}
