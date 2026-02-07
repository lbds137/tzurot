/**
 * Xray — Markdown Formatter
 *
 * GFM tables optimized for feeding to LLMs for architectural analysis.
 */

import { relative } from 'node:path';

import type { Declaration, FileInfo, PackageInfo, XrayReport } from '../types.js';

export function formatMarkdown(report: XrayReport, rootDir: string): string {
  const sections = [
    formatHeader(report),
    formatSummaryTable(report),
    formatHealthWarnings(report),
    ...report.packages.map(pkg => formatPackageDetail(pkg, rootDir)),
  ];

  return sections.filter(s => s !== '').join('\n');
}

function formatHeader(report: XrayReport): string {
  return ['# Xray Codebase Analysis', '', `> Generated: ${report.generatedAt}`, ''].join('\n');
}

function formatSummaryTable(report: XrayReport): string {
  const lines: string[] = [];

  lines.push('## Summary');
  lines.push('');
  lines.push('| Package | Files | Classes | Functions | Interfaces | Types | Lines | Warnings |');
  lines.push('|---------|-------|---------|-----------|------------|-------|-------|----------|');

  for (const pkg of report.packages) {
    const s = report.summary.byPackage[pkg.name];
    const health = s?.health;
    const warningCount = health?.warnings.length ?? 0;
    const warningCell = warningCount > 0 ? `⚠️ ${warningCount}` : '✅';
    const allDecls = pkg.files.flatMap(f => f.declarations);
    lines.push(
      `| ${pkg.name} | ${s?.files ?? 0} | ${s?.classes ?? 0} | ${s?.functions ?? 0} | ${countByKind(allDecls, 'interface')} | ${countByKind(allDecls, 'type')} | ${health?.totalLines ?? 0} | ${warningCell} |`
    );
  }

  lines.push('');
  lines.push(
    `**Totals:** ${report.summary.totalFiles} files, ${report.summary.totalClasses} classes, ${report.summary.totalFunctions} functions, ${report.summary.totalInterfaces} interfaces, ${report.summary.totalTypes} types`
  );
  lines.push('');

  return lines.join('\n');
}

function formatHealthWarnings(report: XrayReport): string {
  const allWarnings: { pkg: string; warnings: string[] }[] = [];
  for (const pkg of report.packages) {
    const health = report.summary.byPackage[pkg.name]?.health;
    if (health !== undefined && health.warnings.length > 0) {
      allWarnings.push({ pkg: pkg.name, warnings: health.warnings });
    }
  }

  if (allWarnings.length === 0) return '';

  const lines = ['## Health Warnings', ''];
  for (const { pkg, warnings } of allWarnings) {
    for (const w of warnings) {
      lines.push(`- **${pkg}**: ${w}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function formatPackageDetail(pkg: PackageInfo, rootDir: string): string {
  const lines: string[] = [];

  lines.push(`## ${pkg.name}`);
  lines.push('');

  for (const file of pkg.files) {
    lines.push(formatFileDetail(file, rootDir));
  }

  return lines.join('\n');
}

function formatFileDetail(file: FileInfo, rootDir: string): string {
  const lines: string[] = [];
  const relPath = relative(rootDir, file.path);

  lines.push(`### \`${relPath}\` (${file.lineCount} lines)`);
  lines.push('');

  if (file.declarations.length > 0) {
    lines.push('| Export | Kind | Name | Signature | Lines |');
    lines.push('|--------|------|------|-----------|-------|');
    for (const decl of file.declarations) {
      lines.push(formatDeclRow(decl));
    }
    lines.push('');
  }

  // Class members
  for (const decl of file.declarations) {
    if (decl.kind === 'class' && decl.members !== undefined && decl.members.length > 0) {
      lines.push(formatClassMembers(decl));
    }
  }

  // Imports
  if (file.imports.length > 0) {
    lines.push(formatImportsDetail(file));
  }

  return lines.join('\n');
}

function formatClassMembers(decl: Declaration): string {
  const lines: string[] = [];

  lines.push(`**${decl.name} members:**`);
  lines.push('');
  lines.push('| Visibility | Kind | Name | Signature | Lines |');
  lines.push('|------------|------|------|-----------|-------|');

  for (const member of decl.members ?? []) {
    const params =
      member.parameters !== undefined
        ? `(${member.parameters.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')})`
        : '';
    const ret = member.returnType !== undefined ? ` → ${member.returnType}` : '';
    const bodyLines = member.bodyLineCount !== undefined ? String(member.bodyLineCount) : '-';
    lines.push(
      `| ${member.visibility} | ${member.kind} | ${member.name} | \`${params}${ret}\` | ${bodyLines} |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

function formatImportsDetail(file: FileInfo): string {
  const lines: string[] = [];

  lines.push('<details><summary>Imports</summary>');
  lines.push('');
  for (const imp of file.imports) {
    const typeTag = imp.isTypeOnly ? ' (type)' : '';
    const names =
      imp.namedImports.length > 0 ? `{ ${imp.namedImports.join(', ')} }` : '(side-effect)';
    lines.push(`- \`${imp.source}\`${typeTag}: ${names}`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

function formatDeclRow(decl: Declaration): string {
  const exported = decl.exported ? '✅' : '-';
  const params =
    decl.parameters !== undefined
      ? `(${decl.parameters.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')})`
      : '';
  const ret = decl.returnType !== undefined ? ` → ${decl.returnType}` : '';
  const signature = `\`${params}${ret}\``;
  const bodyLines = decl.bodyLineCount !== undefined ? String(decl.bodyLineCount) : '-';

  return `| ${exported} | ${decl.kind} | ${decl.name} | ${signature} | ${bodyLines} |`;
}

function countByKind(declarations: Declaration[], kind: string): number {
  return declarations.filter(d => d.kind === kind).length;
}
