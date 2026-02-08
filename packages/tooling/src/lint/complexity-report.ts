/**
 * Complexity Report
 *
 * Analyzes the codebase for files and functions approaching ESLint complexity limits.
 * Runs ESLint with stricter thresholds (80% of actual limits) to catch issues early.
 *
 * Usage:
 *   pnpm ops complexity           # Human-readable report
 *   pnpm ops complexity --verbose # Show all findings (not just top 5)
 *   pnpm ops complexity --no-fail # Don't exit with error code
 *   pnpm ops complexity --json    # Machine-readable JSON for CI dashboard integration
 *
 * Actual ESLint limits:
 * - max-lines: 500 (error)
 * - max-lines-per-function: 100 (warn)
 * - complexity: 20 (warn)
 * - max-statements: 50 (warn)
 * - max-depth: 4 (warn)
 *
 * Report thresholds (80% of limits):
 * - max-lines: 400
 * - max-lines-per-function: 80
 * - complexity: 16
 * - max-statements: 40
 * - max-depth: 3
 */

import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

interface ESLintMessage {
  ruleId: string;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

interface ESLintResult {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
}

interface ReportOptions {
  /** Show all findings instead of top 5 per category */
  verbose?: boolean;
  /** Don't exit with error code even if items are at/over limit */
  noFail?: boolean;
  /** Output machine-readable JSON (for CI dashboard integration) */
  json?: boolean;
}

/**
 * JSON output structure for CI integration
 */
interface ComplexityReportJSON {
  thresholds: {
    thresholdPercent: number;
    rules: Record<RuleId, { threshold: number; limit: number }>;
  };
  findings: Finding[];
  summary: {
    totalFindings: number;
    byRule: Record<
      string,
      {
        count: number;
        atOrOverLimit: number;
        approaching: number;
      }
    >;
    hasFailures: boolean;
  };
}

// Threshold percentages (catch issues at 80% of limit)
const THRESHOLD_PERCENT = 0.8;

// Actual ESLint limits from eslint.config.js
const ACTUAL_LIMITS = {
  'max-lines': 500,
  'max-lines-per-function': 100,
  complexity: 20,
  'max-statements': 50,
  'max-depth': 4,
};

// Calculate warning thresholds (80% of actual limits)
const WARNING_THRESHOLDS = {
  'max-lines': Math.floor(ACTUAL_LIMITS['max-lines'] * THRESHOLD_PERCENT),
  'max-lines-per-function': Math.floor(ACTUAL_LIMITS['max-lines-per-function'] * THRESHOLD_PERCENT),
  complexity: Math.floor(ACTUAL_LIMITS.complexity * THRESHOLD_PERCENT),
  'max-statements': Math.floor(ACTUAL_LIMITS['max-statements'] * THRESHOLD_PERCENT),
  'max-depth': Math.floor(ACTUAL_LIMITS['max-depth'] * THRESHOLD_PERCENT),
};

type RuleId = keyof typeof WARNING_THRESHOLDS;

interface Finding {
  file: string;
  rule: RuleId;
  message: string;
  line: number;
  currentValue: number;
  threshold: number;
  limit: number;
  percentOfLimit: number;
}

const RULE_NAMES: Record<RuleId, string> = {
  'max-lines': 'File Size',
  'max-lines-per-function': 'Function Length',
  complexity: 'Cyclomatic Complexity',
  'max-statements': 'Function Statements',
  'max-depth': 'Nesting Depth',
};

function parseValueFromMessage(message: string): number {
  // Extract numeric value from ESLint messages like:
  // "File has too many lines (450). Maximum allowed is 400."
  // "Function has too many statements (42). Maximum allowed is 40."
  // "Function has a complexity of 17."
  const match = /\((\d+)\)|of (\d+)/.exec(message);
  if (match) {
    return parseInt(match[1] ?? match[2], 10);
  }
  return 0;
}

function categorizeFindings(findings: Finding[]): Map<RuleId, Finding[]> {
  const byRule = new Map<RuleId, Finding[]>();

  for (const finding of findings) {
    const existing = byRule.get(finding.rule);
    if (existing) {
      existing.push(finding);
    } else {
      byRule.set(finding.rule, [finding]);
    }
  }

  // Sort each category by percentage of limit (highest first)
  for (const [, items] of byRule) {
    items.sort((a, b) => b.percentOfLimit - a.percentOfLimit);
  }

  return byRule;
}

function formatFinding(finding: Finding, rootDir: string): string {
  const relPath = relative(rootDir, finding.file);
  const percent = Math.round(finding.percentOfLimit);
  // Clamp bar to max 10 blocks (100%)
  const filledBlocks = Math.min(10, Math.floor(percent / 10));
  const emptyBlocks = Math.max(0, 10 - filledBlocks);
  const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

  return `  ${relPath}:${finding.line}
    [${bar}] ${percent}% (${finding.currentValue}/${finding.limit})`;
}

function printThresholds(): void {
  console.log('🔍 Analyzing codebase complexity...\n');
  console.log(`Thresholds (${THRESHOLD_PERCENT * 100}% of ESLint limits):`);
  console.log(
    `  • max-lines: ${WARNING_THRESHOLDS['max-lines']} (limit: ${ACTUAL_LIMITS['max-lines']})`
  );
  console.log(
    `  • max-lines-per-function: ${WARNING_THRESHOLDS['max-lines-per-function']} (limit: ${ACTUAL_LIMITS['max-lines-per-function']})`
  );
  console.log(
    `  • complexity: ${WARNING_THRESHOLDS.complexity} (limit: ${ACTUAL_LIMITS.complexity})`
  );
  console.log(
    `  • max-statements: ${WARNING_THRESHOLDS['max-statements']} (limit: ${ACTUAL_LIMITS['max-statements']})`
  );
  console.log(
    `  • max-depth: ${WARNING_THRESHOLDS['max-depth']} (limit: ${ACTUAL_LIMITS['max-depth']})`
  );
  console.log('');
}

function buildRuleOverrides(): string[] {
  return [
    `--rule=max-lines: ["warn", {"max": ${WARNING_THRESHOLDS['max-lines']}, "skipBlankLines": true, "skipComments": true}]`,
    `--rule=max-lines-per-function: ["warn", {"max": ${WARNING_THRESHOLDS['max-lines-per-function']}, "skipBlankLines": true, "skipComments": true}]`,
    `--rule=complexity: ["warn", {"max": ${WARNING_THRESHOLDS.complexity}}]`,
    `--rule=max-statements: ["warn", {"max": ${WARNING_THRESHOLDS['max-statements']}}]`,
    `--rule=max-depth: ["warn", {"max": ${WARNING_THRESHOLDS['max-depth']}}]`,
  ];
}

function runEslint(rootDir: string): ESLintResult[] {
  const ruleOverrides = buildRuleOverrides();

  let eslintOutput: string;
  try {
    eslintOutput = execFileSync(
      'npx',
      ['eslint', '--format=json', ...ruleOverrides, 'services/', 'packages/'],
      {
        cwd: rootDir,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large output
      }
    );
  } catch (error) {
    // ESLint exits with non-zero if there are warnings/errors - we still want the output
    if (error instanceof Error && 'stdout' in error) {
      eslintOutput = (error as { stdout: string }).stdout;
    } else {
      throw error;
    }
  }

  try {
    return JSON.parse(eslintOutput) as ESLintResult[];
  } catch {
    console.error('Failed to parse ESLint output');
    console.error(eslintOutput);
    process.exit(1);
  }
}

function extractFindings(results: ESLintResult[]): Finding[] {
  const findings: Finding[] = [];
  const relevantRules = new Set(Object.keys(WARNING_THRESHOLDS));

  for (const result of results) {
    for (const message of result.messages) {
      if (relevantRules.has(message.ruleId)) {
        const rule = message.ruleId as RuleId;
        const currentValue = parseValueFromMessage(message.message);
        const limit = ACTUAL_LIMITS[rule];

        findings.push({
          file: result.filePath,
          rule,
          message: message.message,
          line: message.line,
          currentValue,
          threshold: WARNING_THRESHOLDS[rule],
          limit,
          percentOfLimit: (currentValue / limit) * 100,
        });
      }
    }
  }

  return findings;
}

function printFindings(byRule: Map<RuleId, Finding[]>, rootDir: string, verbose: boolean): void {
  for (const [rule, items] of byRule) {
    console.log(`\n${RULE_NAMES[rule]} (${items.length} items)`);
    console.log('─'.repeat(50));

    const displayCount = verbose ? items.length : Math.min(5, items.length);
    for (let i = 0; i < displayCount; i++) {
      console.log(formatFinding(items[i], rootDir));
    }

    if (!verbose && items.length > 5) {
      console.log(`  ... and ${items.length - 5} more (use --verbose to see all)`);
    }
  }
}

function printSummary(byRule: Map<RuleId, Finding[]>, findings: Finding[], noFail: boolean): void {
  console.log('\n' + '═'.repeat(50));
  console.log('Summary:');

  for (const [rule, items] of byRule) {
    const atLimit = items.filter(i => i.percentOfLimit >= 100).length;
    const approaching = items.filter(i => i.percentOfLimit >= 80 && i.percentOfLimit < 100).length;
    console.log(`  ${RULE_NAMES[rule]}: ${atLimit} at/over limit, ${approaching} approaching`);
  }

  // Exit with non-zero if anything is at or over the actual limit (unless --no-fail)
  const atLimit = findings.filter(f => f.percentOfLimit >= 100);
  if (atLimit.length > 0) {
    console.log(`\n❌ ${atLimit.length} items are at or over ESLint limits and need attention.`);
    if (!noFail) {
      process.exit(1);
    }
    return;
  }

  console.log('\n💡 Consider refactoring items above 80% before they hit the limit.');
}

function buildJSONOutput(
  findings: Finding[],
  byRule: Map<RuleId, Finding[]>
): ComplexityReportJSON {
  const summaryByRule: ComplexityReportJSON['summary']['byRule'] = {};

  for (const [rule, items] of byRule) {
    summaryByRule[rule] = {
      count: items.length,
      atOrOverLimit: items.filter(i => i.percentOfLimit >= 100).length,
      approaching: items.filter(i => i.percentOfLimit >= 80 && i.percentOfLimit < 100).length,
    };
  }

  const hasFailures = findings.some(f => f.percentOfLimit >= 100);

  return {
    thresholds: {
      thresholdPercent: THRESHOLD_PERCENT * 100,
      rules: {
        'max-lines': {
          threshold: WARNING_THRESHOLDS['max-lines'],
          limit: ACTUAL_LIMITS['max-lines'],
        },
        'max-lines-per-function': {
          threshold: WARNING_THRESHOLDS['max-lines-per-function'],
          limit: ACTUAL_LIMITS['max-lines-per-function'],
        },
        complexity: {
          threshold: WARNING_THRESHOLDS.complexity,
          limit: ACTUAL_LIMITS.complexity,
        },
        'max-statements': {
          threshold: WARNING_THRESHOLDS['max-statements'],
          limit: ACTUAL_LIMITS['max-statements'],
        },
        'max-depth': {
          threshold: WARNING_THRESHOLDS['max-depth'],
          limit: ACTUAL_LIMITS['max-depth'],
        },
      },
    },
    findings,
    summary: {
      totalFindings: findings.length,
      byRule: summaryByRule,
      hasFailures,
    },
  };
}

export async function runComplexityReport(options: ReportOptions = {}): Promise<void> {
  const rootDir = resolve(process.cwd());

  if (!options.json) {
    printThresholds();
  }

  const results = runEslint(rootDir);
  const findings = extractFindings(results);
  const byRule = categorizeFindings(findings);

  // JSON output mode - for CI integration
  if (options.json) {
    const jsonOutput = buildJSONOutput(findings, byRule);
    console.log(JSON.stringify(jsonOutput, null, 2));

    // Exit with non-zero if failures (unless --no-fail)
    if (jsonOutput.summary.hasFailures && !options.noFail) {
      process.exit(1);
    }
    return;
  }

  // Human-readable output mode
  if (findings.length === 0) {
    console.log('✅ No files or functions approaching complexity limits!\n');
    return;
  }

  console.log(`⚠️  Found ${findings.length} items approaching limits:\n`);

  printFindings(byRule, rootDir, options.verbose ?? false);
  printSummary(byRule, findings, options.noFail ?? false);
}
