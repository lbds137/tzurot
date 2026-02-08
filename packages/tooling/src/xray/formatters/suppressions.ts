/**
 * Xray — Suppression Audit Formatter
 *
 * Aggregates lint/type suppression comments across the codebase
 * and renders an audit report for tracking tech debt.
 */

import chalk from 'chalk';
import { relative } from 'node:path';

import type { SuppressionInfo, XrayReport } from '../types.js';

const SEPARATOR = '═══════════════════════════════════════════════════════';
const MAX_BAR_WIDTH = 20;
const TOP_N = 10;

interface FlatSuppression {
  suppression: SuppressionInfo;
  filePath: string;
  packageName: string;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function renderBar(count: number, maxCount: number): string {
  const width = maxCount > 0 ? Math.max(1, Math.round((count / maxCount) * MAX_BAR_WIDTH)) : 0;
  return '█'.repeat(width);
}

function flattenSuppressions(report: XrayReport): FlatSuppression[] {
  return report.packages.flatMap(pkg =>
    pkg.files.flatMap(file =>
      file.suppressions.map(suppression => ({
        suppression,
        filePath: file.path,
        packageName: pkg.name,
      }))
    )
  );
}

function renderCountSection(lines: string[], heading: string, entries: [string, number][]): void {
  lines.push(chalk.cyan.bold(heading));
  const labelWidth = Math.max(...entries.map(([k]) => k.length));
  for (const [label, count] of entries) {
    lines.push(`  ${label.padEnd(labelWidth)}  ${chalk.bold(String(count).padStart(4))}`);
  }
  lines.push('');
}

function renderJustificationSection(lines: string[], flat: FlatSuppression[]): void {
  const byJustification = countBy(flat, f => {
    const j = f.suppression.justification;
    if (j === undefined || j.trim() === '') return '\u26a0\ufe0f  No justification';
    return j;
  });
  lines.push(chalk.cyan.bold('By justification:'));
  const entries = [...byJustification.entries()];
  const labelWidth = Math.max(...entries.map(([k]) => k.length));
  for (const [justification, count] of entries) {
    const isWarning = justification.startsWith('\u26a0\ufe0f');
    const label = isWarning
      ? chalk.yellow(justification.padEnd(labelWidth))
      : justification.padEnd(labelWidth);
    const countStr = isWarning
      ? chalk.yellow.bold(String(count).padStart(4))
      : chalk.bold(String(count).padStart(4));
    lines.push(`  ${label}  ${countStr}`);
  }
  lines.push('');
}

function renderPackageSection(lines: string[], flat: FlatSuppression[]): void {
  const byPackage = countBy(flat, f => f.packageName);
  const maxPkgCount = Math.max(...[...byPackage.values()]);
  lines.push(chalk.cyan.bold('By package:'));
  const labelWidth = Math.max(...[...byPackage.keys()].map(k => k.length));
  for (const [pkg, count] of byPackage) {
    const bar = chalk.cyan(renderBar(count, maxPkgCount));
    lines.push(`  ${pkg.padEnd(labelWidth)}  ${chalk.bold(String(count).padStart(4))}  ${bar}`);
  }
  lines.push('');
}

export function formatSuppressions(report: XrayReport, rootDir: string): string {
  const flat = flattenSuppressions(report);
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(SEPARATOR));
  lines.push(chalk.cyan.bold('                 SUPPRESSION AUDIT                     '));
  lines.push(chalk.cyan.bold(SEPARATOR));
  lines.push('');

  if (flat.length === 0) {
    lines.push(chalk.green('No suppressions found.'));
    return lines.join('\n');
  }

  const packageCount = new Set(flat.map(f => f.packageName)).size;
  lines.push(
    `${chalk.bold(String(flat.length))} suppressions across ${chalk.bold(String(packageCount))} package${packageCount === 1 ? '' : 's'}`
  );
  lines.push('');

  const byKind = countBy(flat, f => f.suppression.kind);
  renderCountSection(lines, 'By kind:', [...byKind.entries()]);

  const byRule = countBy(flat, f => f.suppression.rule ?? '(no rule specified)');
  const ruleEntries = [...byRule.entries()].slice(0, TOP_N);
  renderCountSection(lines, `By rule (top ${Math.min(TOP_N, byRule.size)}):`, ruleEntries);

  renderJustificationSection(lines, flat);
  renderPackageSection(lines, flat);

  // Files with most suppressions (top N)
  const byFile = countBy(flat, f => `${f.packageName}/${relative(rootDir, f.filePath)}`);
  const fileEntries = [...byFile.entries()].slice(0, TOP_N);
  renderCountSection(
    lines,
    `Files with most suppressions (top ${Math.min(TOP_N, byFile.size)}):`,
    fileEntries
  );

  // Remove trailing empty line from last section
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
