/**
 * Xray — Terminal Formatter
 *
 * Chalk-colored summary output for terminal consumption.
 */

import chalk from 'chalk';
import { relative } from 'node:path';

import type { Declaration, PackageHealth, XrayReport } from '../types.js';

const SEPARATOR = '═══════════════════════════════════════════════════════';

const HEALTH_THRESHOLDS = {
  totalLines: 3000,
  fileCount: 40,
  exportedDeclarations: 50,
  totalSuppressions: 20,
  maxFileLines: 400,
  avgDeclarationsPerFile: 8,
} as const;

interface FormatOptions {
  summary?: boolean;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Multi-section terminal formatter: package summary → file details → declaration lists → import analysis with color coding
export function formatTerminal(
  report: XrayReport,
  rootDir: string,
  options: FormatOptions = {}
): string {
  const { summary: summaryOnly = false } = options;
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(SEPARATOR));
  lines.push(chalk.cyan.bold('                    XRAY ANALYSIS                      '));
  lines.push(chalk.cyan.bold(SEPARATOR));
  lines.push('');

  for (const pkg of report.packages) {
    const pkgSummary = report.summary.byPackage[pkg.name];
    const health = pkgSummary?.health;

    const suppressionTag =
      health !== undefined && health.totalSuppressions > 0
        ? chalk.yellow(`, ${health.totalSuppressions} suppressions`)
        : '';
    lines.push(
      chalk.cyan.bold(`📦 ${pkg.name}`) +
        chalk.dim(` — ${pkg.files.length} files, ${health?.totalLines ?? 0} lines`) +
        suppressionTag
    );

    // Health warnings
    if (health !== undefined && health.warnings.length > 0) {
      for (const warning of health.warnings) {
        lines.push(chalk.yellow(`   ⚠️  ${warning}`));
      }
    }

    lines.push('');

    for (const file of pkg.files) {
      const relPath = relative(rootDir, file.path);
      const declCount = file.declarations.length;
      const lineInfo =
        file.lineCount > HEALTH_THRESHOLDS.maxFileLines
          ? chalk.yellow(`${file.lineCount} lines`)
          : chalk.dim(`${file.lineCount} lines`);
      const suppressionInfo =
        file.suppressions.length > 0
          ? chalk.yellow(` [${file.suppressions.length} suppressed]`)
          : '';

      lines.push(
        `  ${chalk.green(relPath)} ${lineInfo} ${chalk.dim(`(${declCount} decl)`)}${suppressionInfo}`
      );

      if (!summaryOnly) {
        for (const decl of file.declarations) {
          lines.push(`    ${formatDeclaration(decl)}`);
        }
      }

      lines.push('');
    }
  }

  // Summary
  lines.push(chalk.cyan.bold(SEPARATOR));
  lines.push(chalk.cyan.bold('                      SUMMARY                          '));
  lines.push(chalk.cyan.bold(SEPARATOR));
  lines.push('');

  const s = report.summary;
  lines.push(`  ${chalk.dim('Files:')}      ${s.totalFiles}`);
  lines.push(`  ${chalk.dim('Classes:')}    ${s.totalClasses}`);
  lines.push(`  ${chalk.dim('Functions:')}  ${s.totalFunctions}`);
  lines.push(`  ${chalk.dim('Interfaces:')} ${s.totalInterfaces}`);
  lines.push(`  ${chalk.dim('Types:')}      ${s.totalTypes}`);
  if (s.totalSuppressions > 0) {
    lines.push(`  ${chalk.dim('Suppressions:')} ${chalk.yellow(String(s.totalSuppressions))}`);
  }
  lines.push('');

  lines.push(chalk.dim(`Generated: ${report.generatedAt}`));

  return lines.join('\n');
}

function formatDeclaration(decl: Declaration): string {
  const badge = decl.exported ? chalk.green('⬆') : chalk.dim('·');
  const kindTag = chalk.dim(`[${decl.kind}]`);

  let signature = `${badge} ${kindTag} ${chalk.bold(decl.name)}`;

  if (decl.parameters !== undefined) {
    const params = decl.parameters.map(p => {
      const opt = p.optional ? '?' : '';
      return `${p.name}${opt}: ${p.type}`;
    });
    signature += chalk.dim(`(${params.join(', ')})`);
  }

  if (decl.returnType !== undefined) {
    signature += chalk.dim(` → ${decl.returnType}`);
  }

  if (decl.bodyLineCount !== undefined && decl.bodyLineCount > 50) {
    signature += chalk.yellow(` [${decl.bodyLineCount} lines]`);
  }

  if (decl.members !== undefined && decl.members.length > 0) {
    signature += chalk.dim(` {${decl.members.length} members}`);
  }

  return signature;
}

export function computeHealthWarnings(health: PackageHealth): string[] {
  const warnings: string[] = [];

  if (health.totalLines > HEALTH_THRESHOLDS.totalLines) {
    warnings.push(`Large package (${health.totalLines.toLocaleString()} lines)`);
  }
  if (health.fileCount > HEALTH_THRESHOLDS.fileCount) {
    warnings.push(`Many files (${health.fileCount})`);
  }
  if (health.exportedDeclarations > HEALTH_THRESHOLDS.exportedDeclarations) {
    warnings.push(`Wide API surface (${health.exportedDeclarations} exports)`);
  }
  if (health.largestFile.lines > HEALTH_THRESHOLDS.maxFileLines) {
    warnings.push(`Oversized file: ${health.largestFile.path} (${health.largestFile.lines} lines)`);
  }
  if (health.avgDeclarationsPerFile > HEALTH_THRESHOLDS.avgDeclarationsPerFile) {
    warnings.push(`Dense files (avg ${health.avgDeclarationsPerFile.toFixed(1)} decl/file)`);
  }
  if (health.totalSuppressions > HEALTH_THRESHOLDS.totalSuppressions) {
    warnings.push(`Many lint suppressions (${health.totalSuppressions})`);
  }

  return warnings;
}
