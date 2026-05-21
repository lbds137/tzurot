/**
 * Schema Audit — Markdown report rendering
 */

import type { PrismaField } from './schema-audit-parser.js';
import type { ReadModeClassification } from './schema-audit-reads.js';
import type { WriteSiteClassification } from './schema-audit-writes.js';
import type { AuditFinding } from './schema-audit-findings.js';

export interface MarkdownReportArgs {
  fields: PrismaField[];
  optionalFields: PrismaField[];
  readClassifications: ReadModeClassification[];
  writeClassifications: WriteSiteClassification[];
  findings: AuditFinding[];
  sourceFileCount: number;
  suppressedCount: number;
}

export function printMarkdownReport(args: MarkdownReportArgs): void {
  const {
    fields,
    optionalFields,
    readClassifications,
    writeClassifications,
    findings,
    sourceFileCount,
    suppressedCount,
  } = args;

  console.log('# Schema Audit Report\n');
  console.log(`- **Total fields analyzed**: ${fields.length}`);
  console.log(`- **Optional fields**: ${optionalFields.length}`);
  console.log(`- **Source files analyzed**: ${sourceFileCount}`);
  console.log(`- **Findings**: ${findings.length}`);
  if (suppressedCount > 0) {
    console.log(`- **Suppressed**: ${suppressedCount} (via \`audit.config.ts\`)`);
  }
  console.log();

  if (findings.length === 0) {
    console.log('No findings under the implemented recipes.\n');
    console.log(
      '_Recipes active: read-mode-classification (Primary), bimodal-writes (Secondary), always-passed-no-default (Tertiary)._'
    );
    return;
  }

  const bySeverity = new Map<string, AuditFinding[]>();
  for (const f of findings) {
    const list = bySeverity.get(f.severity) ?? [];
    list.push(f);
    bySeverity.set(f.severity, list);
  }

  for (const severity of ['HIGH', 'MEDIUM', 'LOW']) {
    const group = bySeverity.get(severity);
    if (!group || group.length === 0) continue;
    console.log(`## ${severity}\n`);
    for (const f of group) {
      printFindingBlock(f, readClassifications, writeClassifications);
    }
  }
}

function printFindingBlock(
  f: AuditFinding,
  reads: ReadModeClassification[],
  writes: WriteSiteClassification[]
): void {
  console.log(`### \`${f.model}.${f.field}\` — ${f.recipe}\n`);
  console.log(`**Evidence**: ${f.evidence}\n`);
  console.log(`**Fix shape**: ${f.fixShape}\n`);

  const read = reads.find(c => c.model === f.model && c.field === f.field);
  if (read && read.totalReads > 0) {
    console.log(
      `**Read breakdown**: ${read.totalReads} total — ` +
        `${read.nullishCoalescingReads} \`??\`, ` +
        `${read.truthinessGuardReads} truthiness-guard, ` +
        `${read.nonNullAssertionReads} non-null-assertion.\n`
    );
  }
  const write = writes.find(w => w.model === f.model && w.field === f.field);
  if (write && write.totalSites > 0) {
    console.log(
      `**Write breakdown**: ${write.totalSites} \`.create\`/\`.upsert\` sites — ` +
        `${write.valueSites} value, ` +
        `${write.nullLiteralSites} null-literal, ` +
        `${write.omittedSites} omitted, ` +
        `${write.unclassifiableSites} unclassifiable.\n`
    );
  }
}
