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
   * Source globs to analyze. Test files are excluded via a glob-independent
   * `!**\/*.test.ts` negation, so custom globs (including `*.tsx`-shaped
   * ones) don't need any particular suffix.
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

  const { paths: sourceFilePaths, project } = globSourceFiles(repoRoot, sourceGlobs);

  const readClassifications = classifyReads(optionalFields, project);
  const writeClassifications = analyzeWrites(optionalFields, project);
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

/**
 * Resolve source files via ts-morph's glob-aware project loader. Returns the
 * PARSED project alongside the paths: the analyzers reuse it directly, so the
 * source tree is parsed once per audit run instead of once per pass.
 *
 * The test exclusion is a glob-independent `!**\/*.test.ts` negation (it used
 * to be derived by suffix-substituting each input glob's `*.ts` → `*.test.ts`,
 * which silently no-opped — and excluded nothing — for any custom glob not
 * ending in `*.ts`). `**\/*.test.ts` matches any filename ending in
 * `.test.ts`, including `Foo.component.test.ts` — verified empirically.
 *
 * Exported for tests; production entry is {@link runSchemaAudit}.
 */
export function globSourceFiles(
  repoRoot: string,
  sourceGlobs: string[]
): { paths: string[]; project: Project } {
  const project = new Project({ compilerOptions: { allowJs: false, skipLibCheck: true } });
  project.addSourceFilesAtPaths([
    ...sourceGlobs.map(glob => `${repoRoot}/${glob}`),
    `!${repoRoot}/**/*.test.ts`,
    `!${repoRoot}/**/dist/**`,
    `!${repoRoot}/**/node_modules/**`,
  ]);
  return { paths: project.getSourceFiles().map(sf => sf.getFilePath()), project };
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
