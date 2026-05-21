/**
 * Schema Audit — Prisma schema parser
 *
 * Parses `prisma/schema.prisma` to extract field-level metadata: model name,
 * field name, type, optional flag, `@default` value, and triple-slash docs.
 *
 * Uses regex for milestone-1 simplicity. Edge cases that may require upgrading
 * to `@prisma/internals` `getDMMF()` (deferred to a later milestone):
 * - `@@map` and `@map` directives (currently ignored — we use schema names)
 * - Multi-line field attributes
 * - Complex composite types
 */

import { readFileSync } from 'node:fs';

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

/**
 * Parse `schema.prisma` and return all field-level metadata.
 */
export function parsePrismaSchema(schemaPath: string): PrismaField[] {
  const content = readFileSync(schemaPath, 'utf-8');
  const fields: PrismaField[] = [];
  for (const modelMatch of content.matchAll(PRISMA_MODEL_BLOCK_RE)) {
    parseModelBody(modelMatch[1], modelMatch[2], fields);
  }
  return fields;
}
