/**
 * Schema Audit Tool
 *
 * Finds Prisma columns marked `?` (optional) where `null` is NOT a meaningful
 * application state — workarounds that ship latent bugs.
 *
 * Design rationale and council-pass synthesis:
 * `docs/proposals/backlog/schema-audit-tool-design.md`.
 *
 * Milestone-1 scope (this file):
 * - Schema parsing via regex (model name → field name → type/optional/@default/triple-slash doc)
 * - Recipe Primary: read-mode classification (`??` vs `!= null` truthiness guards)
 * - Markdown output
 *
 * Milestone-2 (next session):
 * - Recipe Secondary: bimodal-writes detection
 * - Recipe Tertiary: refined Recipe A (defaults-aware)
 * - audit.config.ts suppression mechanism with schema validation
 * - JSON output mode
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, SyntaxKind, Node, type PropertyAccessExpression } from 'ts-morph';

/** Parsed Prisma field metadata. */
export interface PrismaField {
  /** Model name (camelCase as written in the schema). */
  model: string;
  /** Field name (camelCase as written in the schema). */
  field: string;
  /** Prisma type (e.g., `String`, `DateTime`, `Json`, `User`, `LlmConfig`). */
  type: string;
  /** Whether the column is marked optional (`?`). */
  optional: boolean;
  /** Value of `@default(...)` if present, or null. */
  defaultValue: string | null;
  /** Triple-slash doc comment immediately above the field, or null. */
  doc: string | null;
}

/** Read-mode classification for a single optional column. */
export interface ReadModeClassification {
  model: string;
  field: string;
  /** Reads of shape `obj.field ?? fallback` — convenience-nullable signal. */
  nullishCoalescingReads: number;
  /** Reads guarded by `obj.field != null` / `if (obj.field)` etc — state-machine signal. */
  truthinessGuardReads: number;
  /** Reads using `obj.field!` (non-null assertion) — fake-optional signal. */
  nonNullAssertionReads: number;
  /** Total read sites observed. */
  totalReads: number;
}

export interface AuditFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  recipe: string;
  model: string;
  field: string;
  evidence: string;
  fixShape: string;
}

// ReDoS warnings disabled: input is the project's own prisma/schema.prisma,
// not user-controlled, so polynomial-backtracking exploits don't apply. The
// regex shapes are constrained to match human-authored Prisma field syntax.
/* eslint-disable regexp/no-super-linear-backtracking -- Trusted input: schema.prisma is project-controlled, not adversarial; ReDoS exploit requires malicious input which can't happen here. */
const PRISMA_MODEL_BLOCK_RE = /^model[ \t]+(\w+)[ \t]*\{([\s\S]*?)^\}/gm;
const FIELD_LINE_RE = /^([ \t]*)(\w+)[ \t]+(\w+)(\?)?[ \t]*(.*)$/;
const TRIPLE_SLASH_RE = /^[ \t]*\/\/\/[ \t]*(.*)$/;
/* eslint-enable regexp/no-super-linear-backtracking */

/**
 * Extract the value inside a `@default(...)` directive, handling nested
 * parens (e.g., `@default(now())`, `@default(dbgenerated("gen_random_uuid()"))`).
 *
 * Returns the captured inner string, or null if `@default(` is not found.
 */
function extractDefaultValue(line: string): string | null {
  const start = line.indexOf('@default(');
  if (start === -1) return null;
  let depth = 0;
  const inner = start + '@default('.length;
  for (let i = inner; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      if (depth === 0) {
        return line.slice(inner, i);
      }
      depth -= 1;
    }
  }
  return null; // Unbalanced parens — treat as no default.
}

/**
 * Parse `schema.prisma` and return all field-level metadata.
 *
 * Milestone-1 uses regex for simplicity. Edge cases that may require upgrading
 * to `@prisma/internals` `getDMMF()`:
 * - `@@map` and `@map` directives (currently ignored — we use schema names)
 * - Multi-line field attributes
 * - Complex composite types
 *
 * Re-evaluate if these surface as false positives.
 */
type LineKind =
  | { kind: 'tripleSlash'; doc: string }
  | { kind: 'reset' } // Blank line or non-doc comment — resets pendingDoc.
  | { kind: 'skip' } // Block-level directive (@@...) — does not reset pendingDoc.
  | { kind: 'field'; field: string; type: string; optional: boolean; defaultValue: string | null }
  | { kind: 'unrecognized' };

function classifyLine(rawLine: string): LineKind {
  const tripleSlashMatch = TRIPLE_SLASH_RE.exec(rawLine);
  if (tripleSlashMatch) {
    return { kind: 'tripleSlash', doc: tripleSlashMatch[1] };
  }
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith('//')) {
    return { kind: 'reset' };
  }
  if (trimmed.startsWith('@@')) {
    return { kind: 'skip' };
  }
  const fieldMatch = FIELD_LINE_RE.exec(rawLine);
  if (!fieldMatch) {
    return { kind: 'unrecognized' };
  }
  const [, , fieldName, fieldType, optionalMarker, rest] = fieldMatch;
  return {
    kind: 'field',
    field: fieldName,
    type: fieldType,
    optional: optionalMarker === '?',
    defaultValue: extractDefaultValue(rest)?.trim() ?? null,
  };
}

function parseModelBody(modelName: string, body: string, fields: PrismaField[]): void {
  let pendingDoc: string | null = null;
  for (const rawLine of body.split('\n')) {
    const parsed = classifyLine(rawLine);
    if (parsed.kind === 'tripleSlash') {
      pendingDoc = pendingDoc === null ? parsed.doc : `${pendingDoc} ${parsed.doc}`;
      continue;
    }
    if (parsed.kind === 'reset' || parsed.kind === 'unrecognized') {
      pendingDoc = null;
      continue;
    }
    if (parsed.kind === 'skip') {
      continue;
    }
    fields.push({
      model: modelName,
      field: parsed.field,
      type: parsed.type,
      optional: parsed.optional,
      defaultValue: parsed.defaultValue,
      doc: pendingDoc,
    });
    pendingDoc = null;
  }
}

export function parsePrismaSchema(schemaPath: string): PrismaField[] {
  const content = readFileSync(schemaPath, 'utf-8');
  const fields: PrismaField[] = [];
  for (const modelMatch of content.matchAll(PRISMA_MODEL_BLOCK_RE)) {
    parseModelBody(modelMatch[1], modelMatch[2], fields);
  }
  return fields;
}

/**
 * Walk a set of TS source files and classify reads of `obj.field` for each
 * given (model, field) pair. The model is matched on the IDENTIFIER name of
 * the receiver — i.e., a read `user.defaultLlmConfigId` matches `User`/`defaultLlmConfigId`
 * iff the receiver was bound to a variable that any heuristic associates with
 * the `User` model.
 *
 * Milestone-1 heuristic: receiver name matches the model name case-insensitively
 * OR matches `users` (camelCase plural). This catches the common patterns in
 * tzurot's codebase (`user.x`, `personality.y`, etc.) without doing full
 * type-resolution. Type-resolution is a milestone-2 upgrade if false-positive
 * rate is too high.
 */
export function classifyReads(
  optionalFields: PrismaField[],
  sourceFilePaths: string[]
): ReadModeClassification[] {
  const project = new Project({
    compilerOptions: { allowJs: false, skipLibCheck: true },
    useInMemoryFileSystem: false,
  });
  for (const path of sourceFilePaths) {
    project.addSourceFileAtPathIfExists(path);
  }

  const classifications = new Map<string, ReadModeClassification>();
  for (const field of optionalFields) {
    const key = `${field.model}.${field.field}`;
    classifications.set(key, {
      model: field.model,
      field: field.field,
      nullishCoalescingReads: 0,
      truthinessGuardReads: 0,
      nonNullAssertionReads: 0,
      totalReads: 0,
    });
  }

  /** Heuristic: does `receiverName` likely refer to the given model? */
  const matchesModel = (receiverName: string, model: string): boolean => {
    const lowerReceiver = receiverName.toLowerCase();
    const lowerModel = model.toLowerCase();
    return lowerReceiver === lowerModel || lowerReceiver === `${lowerModel}s`;
  };

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant(node => {
      if (!Node.isPropertyAccessExpression(node)) return;
      const fieldName = node.getName();
      const receiver = node.getExpression();
      if (!Node.isIdentifier(receiver)) return;
      const receiverName = receiver.getText();

      // Find the matching (model, field) classification, if any.
      for (const field of optionalFields) {
        if (field.field !== fieldName) continue;
        if (!matchesModel(receiverName, field.model)) continue;

        const classification = classifications.get(`${field.model}.${field.field}`);
        if (!classification) continue;

        classification.totalReads += 1;
        classifyReadSite(node, classification);
        break;
      }
    });
  }

  return Array.from(classifications.values());
}

/**
 * Classify a read site within a `BinaryExpression` parent.
 * Returns the contribution to the classification, or null if not classifiable.
 */
function classifyBinaryParent(
  node: PropertyAccessExpression,
  parent: Node
): 'nullishCoalescing' | 'truthinessGuard' | null {
  const binaryNode = parent.asKindOrThrow(SyntaxKind.BinaryExpression);
  const operatorText = binaryNode.getOperatorToken().getText();

  if (operatorText === '??' && binaryNode.getLeft() === node) {
    return 'nullishCoalescing';
  }
  const isEqOp =
    operatorText === '!=' ||
    operatorText === '!==' ||
    operatorText === '==' ||
    operatorText === '===';
  if (!isEqOp) {
    return null;
  }
  const other = binaryNode.getLeft() === node ? binaryNode.getRight() : binaryNode.getLeft();
  const otherText = other.getText();
  if (otherText === 'null' || otherText === 'undefined') {
    return 'truthinessGuard';
  }
  return null;
}

const TRUTHINESS_CONTEXT_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  // `!obj.field` — prefix unary
  SyntaxKind.PrefixUnaryExpression,
]);

/**
 * Classify a single read site (`obj.field` access) into nullish-coalescing,
 * truthiness-guard, or non-null-assertion bucket. Mutates `classification`.
 * Unclassified reads still bump `totalReads` at the caller.
 */
function classifyReadSite(
  node: PropertyAccessExpression,
  classification: ReadModeClassification
): void {
  const parent = node.getParent();
  if (parent === undefined) return;
  const parentKind = parent.getKind();

  if (parentKind === SyntaxKind.NonNullExpression) {
    classification.nonNullAssertionReads += 1;
    return;
  }
  if (parentKind === SyntaxKind.BinaryExpression) {
    const result = classifyBinaryParent(node, parent);
    if (result === 'nullishCoalescing') {
      classification.nullishCoalescingReads += 1;
      return;
    }
    if (result === 'truthinessGuard') {
      classification.truthinessGuardReads += 1;
      return;
    }
    return;
  }
  if (TRUTHINESS_CONTEXT_KINDS.has(parentKind)) {
    classification.truthinessGuardReads += 1;
  }
}

/**
 * Per Opus 4.7's heuristic: classify each optional column as
 * convenience-nullable (>50% `??` reads) vs state machine (>50% truthiness guards).
 */
export function generateFindings(
  classifications: ReadModeClassification[],
  fields: PrismaField[]
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const fieldByKey = new Map(fields.map(f => [`${f.model}.${f.field}`, f]));

  for (const c of classifications) {
    if (c.totalReads === 0) continue; // Field exists but never read — separate concern (Recipe E-like).
    const field = fieldByKey.get(`${c.model}.${c.field}`);
    if (field?.optional !== true) continue; // Only flag fields that are actually optional.

    const coalescingShare = c.nullishCoalescingReads / c.totalReads;
    const truthinessShare = c.truthinessGuardReads / c.totalReads;
    const assertionShare = c.nonNullAssertionReads / c.totalReads;

    if (assertionShare >= 0.5) {
      findings.push({
        severity: 'HIGH',
        recipe: 'read-mode-classification',
        model: c.model,
        field: c.field,
        evidence: `${c.nonNullAssertionReads}/${c.totalReads} reads use non-null assertion (\`!\`). The TS code asserts presence, but the schema permits null — silent type-contract violation.`,
        fixShape: `Investigate: either tighten the schema to NOT NULL (with backfill migration) or fix the call sites to guard against null.`,
      });
      continue;
    }

    if (coalescingShare >= 0.5 && coalescingShare > truthinessShare) {
      findings.push({
        severity: 'MEDIUM',
        recipe: 'read-mode-classification',
        model: c.model,
        field: c.field,
        evidence: `${c.nullishCoalescingReads}/${c.totalReads} reads use \`?? fallback\`. The field has a meaningful default — null is convenience, not domain state.`,
        fixShape: `Backfill existing nulls with the canonical fallback value, then ALTER COLUMN SET NOT NULL + drop the \`?\` in schema.prisma. Resolver call sites become dead defensive code.`,
      });
    }
    // Truthiness-dominant reads → likely state machine, do NOT flag.
    // Mixed or unclassified-dominant reads → also no flag (insufficient signal).
  }

  return findings;
}

export interface SchemaAuditOptions {
  schemaPath?: string;
  sourceGlobs?: string[];
  /** Print findings as markdown. */
  format?: 'markdown' | 'json';
}

/**
 * Entry point invoked by the CLI.
 */
export function runSchemaAudit(options: SchemaAuditOptions = {}): void {
  const repoRoot = resolve(process.cwd());
  const schemaPath = options.schemaPath ?? resolve(repoRoot, 'prisma', 'schema.prisma');
  const sourceGlobs = options.sourceGlobs ?? ['services/**/*.ts', 'packages/**/*.ts'];

  const fields = parsePrismaSchema(schemaPath);
  const optionalFields = fields.filter(f => f.optional);

  // Glob source files via ts-morph's project mechanism (handles globs natively).
  const project = new Project({ compilerOptions: { allowJs: false, skipLibCheck: true } });
  for (const glob of sourceGlobs) {
    project.addSourceFilesAtPaths([
      `${repoRoot}/${glob}`,
      `!${repoRoot}/${glob.replace('*.ts', '*.test.ts')}`,
      `!${repoRoot}/**/dist/**`,
      `!${repoRoot}/**/node_modules/**`,
    ]);
  }
  const sourceFilePaths = project.getSourceFiles().map(sf => sf.getFilePath());

  const classifications = classifyReads(optionalFields, sourceFilePaths);
  const findings = generateFindings(classifications, fields);

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          stats: {
            totalFields: fields.length,
            optionalFields: optionalFields.length,
            sourceFilesAnalyzed: sourceFilePaths.length,
            findings: findings.length,
          },
          findings,
        },
        null,
        2
      )
    );
    return;
  }

  printMarkdownReport({
    fields,
    optionalFields,
    classifications,
    findings,
    sourceFileCount: sourceFilePaths.length,
  });

  process.exitCode = findings.length > 0 ? 1 : 0;
}

function printMarkdownReport(args: {
  fields: PrismaField[];
  optionalFields: PrismaField[];
  classifications: ReadModeClassification[];
  findings: AuditFinding[];
  sourceFileCount: number;
}): void {
  const { fields, optionalFields, classifications, findings, sourceFileCount } = args;

  console.log('# Schema Audit Report\n');
  console.log(`- **Total fields analyzed**: ${fields.length}`);
  console.log(`- **Optional fields**: ${optionalFields.length}`);
  console.log(`- **Source files analyzed**: ${sourceFileCount}`);
  console.log(`- **Findings**: ${findings.length}\n`);

  if (findings.length === 0) {
    console.log('No findings under the read-mode-classification recipe.\n');
    console.log(
      '_Note: milestone-1 only implements Recipe Primary. Recipe Secondary (bimodal-writes) and Tertiary (refined Recipe A) will be added in milestone-2._'
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
      console.log(`### \`${f.model}.${f.field}\` — ${f.recipe}\n`);
      console.log(`**Evidence**: ${f.evidence}\n`);
      console.log(`**Fix shape**: ${f.fixShape}\n`);
      const classification = classifications.find(c => c.model === f.model && c.field === f.field);
      if (classification) {
        console.log(
          `**Read breakdown**: ${classification.totalReads} total — ` +
            `${classification.nullishCoalescingReads} \`??\`, ` +
            `${classification.truthinessGuardReads} truthiness-guard, ` +
            `${classification.nonNullAssertionReads} non-null-assertion.\n`
        );
      }
    }
  }
}
