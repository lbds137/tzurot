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

export interface BoundaryOptions {
  fix?: boolean;
  verbose?: boolean;
}

interface Violation {
  file: string;
  line: number;
  import: string;
  rule: string;
  severity: 'error' | 'warning';
}

// Define boundary rules
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
 * Check a single file for boundary violations
 */
function checkFile(filePath: string, rules: (typeof BOUNDARY_RULES)[number]): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip non-import lines
    if (!line.includes('import') && !line.includes('require')) {
      continue;
    }

    for (const rule of rules.forbiddenImports) {
      if (rule.pattern.test(line)) {
        violations.push({
          file: filePath,
          line: i + 1,
          import: line.trim(),
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
 * Check architecture boundaries
 */
export async function checkBoundaries(options: BoundaryOptions = {}): Promise<void> {
  const { verbose = false } = options;
  const rootDir = process.cwd();
  const servicesDir = join(rootDir, 'services');

  displayHeader();

  const allViolations: Violation[] = [];
  let totalFilesChecked = 0;

  for (const rule of BOUNDARY_RULES) {
    const serviceDir = join(servicesDir, rule.service, 'src');
    const files = findTypeScriptFiles(serviceDir);

    if (verbose) {
      console.log(chalk.dim(`Checking ${rule.service}: ${files.length} files`));
    }

    totalFilesChecked += files.length;

    for (const file of files) {
      const violations = checkFile(file, rule);
      allViolations.push(...violations);
    }
  }

  console.log(
    chalk.dim(`Checked ${totalFilesChecked} files across ${BOUNDARY_RULES.length} services`)
  );
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
