/**
 * Architecture Boundary Checker
 *
 * Validates that microservices respect their boundaries:
 * - bot-client NEVER imports from @prisma/client directly
 * - Services don't cross-import from each other (only from common-types)
 * - ai-worker internals are not exposed to other services
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';
import { emitSummary } from '../audits/summary.js';

interface BoundaryOptions {
  fix?: boolean;
  verbose?: boolean;
  /** Emit a single-line JSONL AuditSummary instead of human output. */
  summary?: boolean;
}

interface Violation {
  file: string;
  line: number;
  import: string;
  rule: string;
  severity: 'error' | 'warning';
}

// Define boundary rules
/**
 * Prisma CLIENT symbols that still live in `@tzurot/common-types` and must not be
 * imported by bot-client (they reach the database). The former Prisma-backed
 * SERVICES (PersonaResolver, PersonalityService, ConversationHistoryService, the
 * cache invalidators) were extracted to dedicated packages — each carries its own
 * `bot-client → package` depcruise ban — and getPrismaClient/disconnectPrisma were
 * deleted. Exported so the drift test in check-boundaries.test.ts asserts every
 * entry is a real common-types export; a stale entry (a symbol that's since been
 * renamed/deleted/moved) then fails CI instead of silently no-op-matching.
 */
export const BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS = [
  'createPrismaClient',
  'PrismaClient',
  'Prisma',
] as const;

const BOT_CLIENT_PRISMA_SYMBOL_PATTERN = new RegExp(
  `\\b(${BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS.join('|')})\\b[\\s\\S]*?from\\s+['"]@tzurot/common-types(?:/services/prisma)?['"]`
);

const BOUNDARY_RULES: {
  service: string;
  forbiddenImports: { pattern: RegExp; reason: string; severity: 'error' | 'warning' }[];
}[] = [
  {
    service: 'bot-client',
    forbiddenImports: [
      {
        pattern: /@prisma\/client/,
        reason: 'bot-client must not access database directly - use api-gateway endpoints',
        severity: 'error',
      },
      {
        // Prisma reaches bot-client via @tzurot/common-types/services/prisma
        // (Prisma-backed exports), not a direct @prisma/client import — depcruise
        // (module-path matching) treats that subpath as an allowed common-types
        // dependency, so this symbol-level rule is the enforcement. Banned symbols
        // + rationale live on BOT_CLIENT_BANNED_COMMON_TYPES_PRISMA_SYMBOLS above
        // (drift-tested against the services/prisma module).
        pattern: BOT_CLIENT_PRISMA_SYMBOL_PATTERN,
        reason:
          'bot-client must not import Prisma-backed code from @tzurot/common-types - these reach the database; use the gateway HTTP API (HttpPersonalityLoader, routing-context)',
        severity: 'error',
      },
      {
        pattern: /from ['"]\.\.\/\.\.\/\.\.\/services\/ai-worker/,
        reason: 'bot-client must not import from ai-worker internals',
        severity: 'error',
      },
      {
        pattern: /from ['"]\.\.\/\.\.\/\.\.\/services\/api-gateway/,
        reason: 'bot-client must not import from api-gateway internals',
        severity: 'error',
      },
      {
        pattern: /from ['"]@tzurot\/ai-worker/,
        reason: 'bot-client must not depend on ai-worker package',
        severity: 'error',
      },
    ],
  },
  {
    service: 'api-gateway',
    forbiddenImports: [
      {
        pattern: /from ['"]\.\.\/\.\.\/\.\.\/services\/bot-client/,
        reason: 'api-gateway must not import from bot-client internals',
        severity: 'error',
      },
      {
        pattern: /from ['"]\.\.\/\.\.\/\.\.\/services\/ai-worker/,
        reason: 'api-gateway must not import from ai-worker internals',
        severity: 'error',
      },
      {
        pattern: /from ['"]@tzurot\/bot-client/,
        reason: 'api-gateway must not depend on bot-client package',
        severity: 'error',
      },
      {
        pattern: /from ['"]@tzurot\/ai-worker/,
        reason: 'api-gateway must not depend on ai-worker package',
        severity: 'error',
      },
    ],
  },
  {
    service: 'ai-worker',
    forbiddenImports: [
      {
        pattern: /from ['"]\.\.\/\.\.\/\.\.\/services\/bot-client/,
        reason: 'ai-worker must not import from bot-client internals',
        severity: 'error',
      },
      {
        pattern: /from ['"]\.\.\/\.\.\/\.\.\/services\/api-gateway/,
        reason: 'ai-worker must not import from api-gateway internals',
        severity: 'error',
      },
      {
        pattern: /from ['"]discord\.js/,
        reason: 'ai-worker should not import discord.js - use common-types for Discord types',
        severity: 'warning',
      },
      {
        pattern: /from ['"]@tzurot\/bot-client/,
        reason: 'ai-worker must not depend on bot-client package',
        severity: 'error',
      },
    ],
  },
];

/**
 * Find all TypeScript files in a directory recursively
 */
function findTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip node_modules and dist
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') {
        continue;
      }

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...findTypeScriptFiles(fullPath));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return files;
}

/**
 * Match a complete import/require statement, spanning newlines. Three forms:
 *   1. `import … from '…'`        (named/default/namespace; the `…` may wrap lines)
 *   2. `import '…'`               (side-effect import)
 *   3. `require('…')`             (CommonJS)
 * The lazy `[\s\S]*?` in form 1 stops at the first `from '…'`, so each statement
 * is bounded to its own specifier and never bleeds into the next. A bare `from`
 * inside a comment between the braces is skipped: it has no following quote, so
 * the trailing `['"]…['"]` fails there and the engine backtracks to the real
 * `from '…'`.
 */
const IMPORT_STATEMENT_RE =
  /\bimport\b[\s\S]*?\bfrom\b\s*['"][^'"]+['"]|\bimport\s+['"][^'"]+['"]|\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g;

/**
 * Extract each import/require statement as one logical string anchored to the
 * 1-based line where it begins.
 *
 * Collapsing multi-line imports is load-bearing: the imported symbol names in a
 * multi-line `import {\n  getPrismaClient,\n} from '…'` sit on their own lines.
 * A line-by-line scan that only inspects lines containing the `import` keyword
 * never sees them, so a symbol-level rule (e.g. "no getPrismaClient") would
 * silently miss every multi-line import. Joining the statement first makes the
 * symbol list and the module specifier matchable as one unit.
 */
function extractImportStatements(content: string): { line: number; text: string }[] {
  const statements: { line: number; text: string }[] = [];
  for (const match of content.matchAll(IMPORT_STATEMENT_RE)) {
    const line = content.slice(0, match.index ?? 0).split('\n').length;
    statements.push({ line, text: match[0] });
  }
  return statements;
}

/**
 * Check a single file for boundary violations
 */
function checkFile(filePath: string, rules: (typeof BOUNDARY_RULES)[number]): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, 'utf-8');

  for (const statement of extractImportStatements(content)) {
    for (const rule of rules.forbiddenImports) {
      if (rule.pattern.test(statement.text)) {
        violations.push({
          file: filePath,
          line: statement.line,
          // Collapse a possibly multi-line statement to one line for display.
          import: statement.text.replace(/\s+/g, ' ').trim(),
          rule: rule.reason,
          severity: rule.severity,
        });
      }
    }
  }

  return violations;
}

/**
 * Display header for boundary check
 */
function displayHeader(): void {
  // eslint-disable-next-line sonarjs/no-duplicate-string -- CLI decorative separator shared across display functions
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('           ARCHITECTURE BOUNDARY CHECK                  '));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log('');
}

/**
 * Display success message when no violations found
 */
function displaySuccess(): void {
  console.log(chalk.green.bold('✅ No boundary violations found!'));
  console.log('');
  console.log(chalk.dim('All services respect their architectural boundaries:'));
  console.log(chalk.dim('  • bot-client does not access database directly'));
  console.log(chalk.dim('  • Services do not cross-import internal modules'));
  console.log(chalk.dim('  • Shared code lives in common-types'));
}

/**
 * Display violations grouped by severity
 */
function displayViolations(violations: Violation[], rootDir: string): boolean {
  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  if (errors.length > 0) {
    console.log(chalk.red.bold(`❌ Found ${errors.length} boundary violation(s):`));
    console.log('');
    for (const v of errors) {
      console.log(chalk.red(`  ${relative(rootDir, v.file)}:${v.line}`));
      console.log(chalk.dim(`    ${v.import}`));
      console.log(chalk.yellow(`    → ${v.rule}`));
      console.log('');
    }
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow.bold(`⚠️  Found ${warnings.length} warning(s):`));
    console.log('');
    for (const v of warnings) {
      console.log(chalk.yellow(`  ${relative(rootDir, v.file)}:${v.line}`));
      console.log(chalk.dim(`    ${v.import}`));
      console.log(chalk.dim(`    → ${v.rule}`));
      console.log('');
    }
  }

  return errors.length > 0;
}

/**
 * Display footer with tips
 */
function displayFooter(): void {
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.dim('💡 Tips:'));
  console.log(chalk.dim('   • bot-client → api-gateway: Use HTTP endpoints'));
  console.log(chalk.dim('   • Shared code: Move to packages/common-types'));
  console.log(chalk.dim('   • Discord types: Use @tzurot/common-types'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
}

/**
 * Scan every boundary rule's service directory and collect violations.
 * Extracted from checkBoundaries to keep that function under the
 * cognitive-complexity limit.
 */
function collectViolations(
  servicesDir: string,
  opts: { verbose: boolean; summary: boolean }
): { violations: Violation[]; filesChecked: number } {
  const violations: Violation[] = [];
  let filesChecked = 0;

  for (const rule of BOUNDARY_RULES) {
    const serviceDir = join(servicesDir, rule.service, 'src');
    const files = findTypeScriptFiles(serviceDir);

    if (opts.verbose && !opts.summary) {
      console.log(chalk.dim(`Checking ${rule.service}: ${files.length} files`));
    }

    filesChecked += files.length;

    for (const file of files) {
      violations.push(...checkFile(file, rule));
    }
  }

  return { violations, filesChecked };
}

/**
 * Check architecture boundaries
 */
export async function checkBoundaries(options: BoundaryOptions = {}): Promise<void> {
  const { verbose = false, summary = false } = options;
  const rootDir = process.cwd();
  const servicesDir = join(rootDir, 'services');

  if (!summary) {
    displayHeader();
  }

  const { violations: allViolations, filesChecked } = collectViolations(servicesDir, {
    verbose,
    summary,
  });

  const errorCount = allViolations.filter(v => v.severity === 'error').length;

  if (summary) {
    // Only error-severity violations are the hard-fail signal (same exit
    // contract as the human path below); warnings surface as 'warn'.
    emitSummary({
      tool: 'guard:boundaries',
      status: errorCount > 0 ? 'fail' : allViolations.length > 0 ? 'warn' : 'ok',
      findings: allViolations.length,
      baseline: 0,
    });
    if (errorCount > 0) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(chalk.dim(`Checked ${filesChecked} files across ${BOUNDARY_RULES.length} services`));
  console.log('');

  if (allViolations.length === 0) {
    displaySuccess();
  } else {
    const hasErrors = displayViolations(allViolations, rootDir);
    if (hasErrors) {
      process.exitCode = 1;
    }
  }

  displayFooter();
}
