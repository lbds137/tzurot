/**
 * Xray — Analyzer Orchestrator
 *
 * Ties together file discovery, parsing, formatting, and output.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import chalk from 'chalk';

import { discoverFiles } from './file-discovery.js';
import { parseFile } from './file-parser.js';
import { formatJson } from './formatters/json.js';
import { formatMarkdown } from './formatters/markdown.js';
import { formatTerminal, computeHealthWarnings } from './formatters/terminal.js';
import type {
  FileInfo,
  PackageHealth,
  PackageInfo,
  ReportSummary,
  XrayOptions,
  XrayReport,
} from './types.js';

/**
 * Analyze the monorepo and produce a structured report.
 */
export function analyzeMonorepo(rootDir: string, options: XrayOptions = {}): XrayReport {
  const { includePrivate = false, imports: includeImports, format = 'terminal' } = options;

  // Default imports to true for md/json, false for terminal
  const resolvedImports = includeImports ?? format !== 'terminal';

  const discovered = discoverFiles(rootDir, {
    packages: options.packages,
    includeTests: options.includeTests,
  });

  const packages: PackageInfo[] = [];

  for (const pkg of discovered) {
    const files: FileInfo[] = [];

    for (const filePath of pkg.files) {
      const content = readFileSync(filePath, 'utf-8');
      const fileInfo = parseFile(filePath, content, {
        includePrivate,
        includeImports: resolvedImports,
      });
      files.push(fileInfo);
    }

    packages.push({
      name: pkg.name,
      path: pkg.srcDir,
      files,
    });
  }

  const summary = computeSummary(packages, rootDir);

  return {
    generatedAt: new Date().toISOString(),
    packages,
    summary,
  };
}

function computeSummary(packages: PackageInfo[], rootDir: string): ReportSummary {
  const byPackage: ReportSummary['byPackage'] = {};

  for (const pkg of packages) {
    byPackage[pkg.name] = computePackageSummary(pkg, rootDir);
  }

  // Aggregate totals from per-package summaries
  const allDecls = packages.flatMap(p => p.files.flatMap(f => f.declarations));

  const totalSuppressions = packages.reduce(
    (sum, p) => sum + p.files.reduce((fSum, f) => fSum + f.suppressions.length, 0),
    0
  );

  return {
    totalFiles: packages.reduce((sum, p) => sum + p.files.length, 0),
    totalClasses: allDecls.filter(d => d.kind === 'class').length,
    totalFunctions: allDecls.filter(d => d.kind === 'function').length,
    totalInterfaces: allDecls.filter(d => d.kind === 'interface').length,
    totalTypes: allDecls.filter(d => d.kind === 'type').length,
    totalSuppressions,
    byPackage,
  };
}

function computePackageSummary(
  pkg: PackageInfo,
  rootDir: string
): ReportSummary['byPackage'][string] {
  const allDecls = pkg.files.flatMap(f => f.declarations);
  let largestFile = { path: '', lines: 0 };

  for (const file of pkg.files) {
    if (file.lineCount > largestFile.lines) {
      largestFile = { path: relative(rootDir, file.path), lines: file.lineCount };
    }
  }

  const totalSuppressions = pkg.files.reduce((sum, f) => sum + f.suppressions.length, 0);

  const health: PackageHealth = {
    totalLines: pkg.files.reduce((sum, f) => sum + f.lineCount, 0),
    fileCount: pkg.files.length,
    exportedDeclarations: allDecls.filter(d => d.exported).length,
    totalSuppressions,
    largestFile,
    avgDeclarationsPerFile: pkg.files.length > 0 ? allDecls.length / pkg.files.length : 0,
    warnings: [],
  };
  health.warnings = computeHealthWarnings(health);

  return {
    files: pkg.files.length,
    classes: allDecls.filter(d => d.kind === 'class').length,
    functions: allDecls.filter(d => d.kind === 'function').length,
    health,
  };
}

/**
 * Run the xray analysis: discover → parse → format → output.
 */
export async function runXray(options: XrayOptions = {}): Promise<void> {
  const { format = 'terminal', output, summary = false } = options;
  const rootDir = process.cwd();

  const start = performance.now();
  const report = analyzeMonorepo(rootDir, options);
  const elapsed = performance.now() - start;

  let result: string;

  switch (format) {
    case 'json': {
      result = formatJson(report);
      break;
    }
    case 'md': {
      result = formatMarkdown(report, rootDir, { summary });
      break;
    }
    default: {
      result = formatTerminal(report, rootDir, { summary });
      break;
    }
  }

  if (output !== undefined) {
    writeFileSync(output, result, 'utf-8');
    console.log(chalk.green(`✅ Report written to ${output}`));
  } else {
    console.log(result);
  }

  if (format === 'terminal') {
    console.log(chalk.dim(`\nCompleted in ${elapsed.toFixed(0)}ms`));
  }
}
