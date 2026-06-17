/**
 * Schema Audit Tool — entry point
 *
 * Finds Prisma columns marked `?` (optional) where `null` is NOT a meaningful
 * application state — workarounds that ship latent bugs.
 *
 * Design rationale and recipe semantics:
 * `docs/reference/tooling/schema-audit.md`.
 *
 * Implementation is split across sibling modules:
 * - `schema-audit-parser.ts` — Prisma schema parsing
 * - `schema-audit-reads.ts` — Recipe Primary (read-mode classification)
 * - `schema-audit-writes.ts` — write-site classification (powers Secondary + Tertiary)
 * - `schema-audit-findings.ts` — recipe-composing finding generator
 * - `schema-audit-suppression.ts` — audit.config.ts/.json mechanism
 * - `schema-audit-report.ts` — markdown output rendering
 *
 * This file re-exports the public surface and provides the CLI runner.
 */

import { resolve } from 'node:path';
import { Project } from 'ts-morph';

export { parsePrismaSchema, type PrismaField } from './schema-audit-parser.js';
export { classifyReads, type ReadModeClassification } from './schema-audit-reads.js';
export { analyzeWrites, type WriteSiteClassification } from './schema-audit-writes.js';
export { generateFindings, type AuditFinding } from './schema-audit-findings.js';
export {
  loadAuditConfig,
  validateSuppressions,
  applySuppressions,
  type SuppressionEntry,
  type SchemaAuditConfig,
} from './schema-audit-suppression.js';

import { parsePrismaSchema, type PrismaField } from './schema-audit-parser.js';
import { classifyReads } from './schema-audit-reads.js';
import { analyzeWrites } from './schema-audit-writes.js';
import { generateFindings, type AuditFinding } from './schema-audit-findings.js';
import {
  loadAuditConfig,
  validateSuppressions,
  applySuppressions,
} from './schema-audit-suppression.js';
import { printMarkdownReport } from './schema-audit-report.js';

export interface SchemaAuditOptions {
  /** Base directory for resolving relative paths. Defaults to `process.cwd()`. */
  repoRoot?: string;
  schemaPath?: string;
  /**
   * Source globs to analyze. **Each glob MUST end with `*.ts`** — the
   * test-exclusion pattern is derived by suffix-substituting `*.ts` → `*.test.ts`.
   * A glob that doesn't end in `*.ts` (e.g., `services/foo.tsx`) will silently
   * include test files because the substitution becomes a no-op. Track in
   * `backlog/cold/follow-ups.md` for tightening if a real consumer hits this gap.
   */
  sourceGlobs?: string[];
  /** Path to audit.config (defaults to ./audit.config.ts at repo root). */
  configPath?: string;
  /** Print findings as markdown or JSON. */
  format?: 'markdown' | 'json';
}

/**
 * Entry point invoked by the CLI.
 */
export async function runSchemaAudit(options: SchemaAuditOptions = {}): Promise<void> {
  const repoRoot = options.repoRoot ?? resolve(process.cwd());
  const schemaPath = options.schemaPath ?? resolve(repoRoot, 'prisma', 'schema.prisma');
  const sourceGlobs = options.sourceGlobs ?? ['services/**/*.ts', 'packages/**/*.ts'];
  const configPath = options.configPath ?? resolve(repoRoot, 'audit.config.ts');

  const fields = parsePrismaSchema(schemaPath);
  const optionalFields = fields.filter(f => f.optional);

  // Load + validate suppressions BEFORE running any analysis — stale
  // suppression keys fail loudly here, never silently filter findings later.
  const config = await loadAuditConfig(configPath);
  validateSuppressions(config.suppressions, fields);

  const sourceFilePaths = globSourceFiles(repoRoot, sourceGlobs);

  const readClassifications = classifyReads(optionalFields, sourceFilePaths);
  const writeClassifications = analyzeWrites(optionalFields, sourceFilePaths);
  const allFindings = generateFindings(readClassifications, writeClassifications, fields);
  const findings = applySuppressions(allFindings, config.suppressions);
  const suppressedCount = allFindings.length - findings.length;

  if (options.format === 'json') {
    emitJson({
      fields,
      optionalFields,
      sourceFileCount: sourceFilePaths.length,
      findings,
      suppressedCount,
    });
  } else {
    printMarkdownReport({
      fields,
      optionalFields,
      readClassifications,
      writeClassifications,
      findings,
      sourceFileCount: sourceFilePaths.length,
      suppressedCount,
    });
  }

  // Both formats: non-zero exit when findings exist, so CI / scripted
  // consumers can branch on `$?` regardless of which output mode was used.
  process.exitCode = findings.length > 0 ? 1 : 0;
}

/** Resolve source-file paths via ts-morph's glob-aware project loader. */
function globSourceFiles(repoRoot: string, sourceGlobs: string[]): string[] {
  const project = new Project({ compilerOptions: { allowJs: false, skipLibCheck: true } });
  for (const glob of sourceGlobs) {
    // `**/*.test.ts` matches any filename ending in `.test.ts`, including
    // `Foo.int.test.ts` / `Foo.spec.test.ts` — verified empirically. No
    // separate `*.int.test.ts` exclusion needed.
    project.addSourceFilesAtPaths([
      `${repoRoot}/${glob}`,
      `!${repoRoot}/${glob.replace(/\*\.ts$/, '*.test.ts')}`,
      `!${repoRoot}/**/dist/**`,
      `!${repoRoot}/**/node_modules/**`,
    ]);
  }
  return project.getSourceFiles().map(sf => sf.getFilePath());
}

interface JsonEmitArgs {
  fields: PrismaField[];
  optionalFields: PrismaField[];
  sourceFileCount: number;
  findings: AuditFinding[];
  suppressedCount: number;
}

function emitJson(args: JsonEmitArgs): void {
  console.log(
    JSON.stringify(
      {
        stats: {
          totalFields: args.fields.length,
          optionalFields: args.optionalFields.length,
          sourceFilesAnalyzed: args.sourceFileCount,
          findings: args.findings.length,
          suppressedCount: args.suppressedCount,
        },
        findings: args.findings,
      },
      null,
      2
    )
  );
}
