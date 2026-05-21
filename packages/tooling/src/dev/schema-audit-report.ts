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

  const readCoverageWarning = computeReadCoverageWarning(readClassifications, writeClassifications);
  if (readCoverageWarning !== null) {
    console.log();
    console.log(`> ⚠ ${readCoverageWarning}`);
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

/**
 * Surface a warning when many optional fields show zero reads but nonzero
 * write sites. This pattern indicates the read-mode classifier's
 * name-heuristic (Limitation #2) under-counted reads against this codebase's
 * naming conventions — users could otherwise interpret `totalReads: 0` as
 * "this field is unused" when really it's just invisible to the classifier.
 */
function computeReadCoverageWarning(
  reads: ReadModeClassification[],
  writes: WriteSiteClassification[]
): string | null {
  const readsByKey = new Map(reads.map(c => [`${c.model}.${c.field}`, c]));
  let underCountedCount = 0;
  let totalFieldsWithWrites = 0;
  for (const w of writes) {
    if (w.totalSites === 0) continue;
    totalFieldsWithWrites += 1;
    const r = readsByKey.get(`${w.model}.${w.field}`);
    if (!r || r.totalReads === 0) underCountedCount += 1;
  }
  if (totalFieldsWithWrites === 0) return null;
  const ratio = underCountedCount / totalFieldsWithWrites;
  if (ratio < 0.5) return null;
  return (
    `Read-mode classifier found 0 reads for ${underCountedCount}/${totalFieldsWithWrites} ` +
    `fields that have write sites. The name-heuristic matcher (Limitation #2 in ` +
    `\`docs/reference/tooling/schema-audit.md\`) likely under-counts on this codebase ` +
    `— interpret \`totalReads: 0\` as "invisible to classifier," not "no reads."`
  );
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
