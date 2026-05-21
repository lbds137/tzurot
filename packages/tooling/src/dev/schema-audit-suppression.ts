/**
 * Schema Audit — Suppression mechanism
 *
 * Loads `audit.config.ts/.json` to filter out intentional optional columns
 * (state machines, deferred-nulls, etc.). Per Opus 4.7's design: schema-qualified
 * string keys validated against the parsed schema at startup. Rename-safe
 * without coupling to generated Prisma client symbols.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { PrismaField } from './schema-audit-parser.js';
import type { AuditFinding } from './schema-audit-findings.js';

export interface SuppressionEntry {
  /** `Model.fieldName` — e.g., `"User.nsfwVerifiedAt"`. */
  key: string;
  /** Required: why this nullability is intentional (for future readers). */
  reason: string;
  /** Optional: ISO date when this suppression was last reviewed. */
  reviewedAt?: string;
}

export interface SchemaAuditConfig {
  suppressions: SuppressionEntry[];
}

/**
 * Load suppressions from `audit.config.ts` (or `.json`) at the given path.
 * Returns an empty suppressions list if the file doesn't exist.
 *
 * TypeScript suppression files must export `schemaAuditConfig` as the named
 * export. JSON files are loaded as-is.
 */
export async function loadAuditConfig(configPath: string): Promise<SchemaAuditConfig> {
  if (!existsSync(configPath)) {
    return { suppressions: [] };
  }
  if (configPath.endsWith('.json')) {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as SchemaAuditConfig;
  }
  // Dynamic import for .ts / .js — the file must export `schemaAuditConfig`.
  const moduleUrl = `file://${configPath}`;
  const mod = (await import(moduleUrl)) as { schemaAuditConfig?: SchemaAuditConfig };
  if (mod.schemaAuditConfig === undefined) {
    throw new Error(
      `Config file ${configPath} must export \`schemaAuditConfig\` as a named export.`
    );
  }
  return mod.schemaAuditConfig;
}

/**
 * Validate that every suppression key resolves to an OPTIONAL field in the
 * parsed schema. Throws on any stale suppression — these surface immediately
 * rather than silently no-op-ing on a renamed/removed/tightened column.
 */
export function validateSuppressions(
  suppressions: SuppressionEntry[],
  fields: PrismaField[]
): void {
  const fieldByKey = new Map(fields.map(f => [`${f.model}.${f.field}`, f]));
  const errors: string[] = [];
  for (const s of suppressions) {
    const field = fieldByKey.get(s.key);
    if (field === undefined) {
      errors.push(`Suppression key \`${s.key}\` does not resolve to any field in schema.prisma.`);
      continue;
    }
    if (!field.optional) {
      errors.push(
        `Suppression key \`${s.key}\` resolves to a NOT-NULL field — the column has already been tightened. Remove the suppression.`
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(`Schema audit suppression validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Apply suppressions to a finding set — filter out findings whose
 * `Model.fieldName` matches any suppression key.
 */
export function applySuppressions(
  findings: AuditFinding[],
  suppressions: SuppressionEntry[]
): AuditFinding[] {
  const suppressed = new Set(suppressions.map(s => s.key));
  return findings.filter(f => !suppressed.has(`${f.model}.${f.field}`));
}
