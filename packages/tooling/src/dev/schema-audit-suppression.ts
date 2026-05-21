/**
 * Schema Audit — Suppression mechanism
 *
 * Loads `audit.config.ts/.json` to filter out intentional optional columns
 * (state machines, deferred-nulls, etc.). Per Opus 4.7's design: schema-qualified
 * string keys validated against the parsed schema at startup. Rename-safe
 * without coupling to generated Prisma client symbols.
 */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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
    // Surface as a warning (not an error) — a missing audit.config.ts is the
    // expected first-run state, but explicit notice prevents "why is my
    // suppression not working?" confusion when the path is wrong.
    console.warn(
      `[schema-audit] Config not found at ${configPath} — running with no suppressions.`
    );
    return { suppressions: [] };
  }
  if (configPath.endsWith('.json')) {
    const content = readFileSync(configPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (cause) {
      throw new Error(`Config at ${configPath}: malformed JSON — ${(cause as Error).message}`, {
        cause,
      });
    }
    return assertConfigShape(parsed, configPath);
  }
  // Dynamic import for .ts / .js — the file must export `schemaAuditConfig`.
  // Use pathToFileURL() rather than string-interpolating `file://${path}` —
  // raw interpolation breaks on paths with spaces or special characters
  // (and is the URL-construction pattern that 00-critical.md flags).
  const moduleUrl = pathToFileURL(configPath).href;
  const mod = (await import(moduleUrl)) as { schemaAuditConfig?: unknown };
  if (mod.schemaAuditConfig === undefined) {
    throw new Error(
      `Config file ${configPath} must export \`schemaAuditConfig\` as a named export.`
    );
  }
  return assertConfigShape(mod.schemaAuditConfig, configPath);
}

/**
 * Validate the shape of a loaded config object. Returns the typed config on
 * success; throws a useful error on malformed input. Lightweight hand-rolled
 * validation rather than Zod — keeps the tooling package free of a new dep.
 */
function assertConfigShape(value: unknown, configPath: string): SchemaAuditConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Config at ${configPath}: expected an object with \`suppressions\`.`);
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.suppressions)) {
    throw new Error(`Config at ${configPath}: \`suppressions\` must be an array.`);
  }
  for (let i = 0; i < obj.suppressions.length; i += 1) {
    const entry = obj.suppressions[i] as unknown;
    if (entry === null || typeof entry !== 'object') {
      throw new Error(
        `Config at ${configPath}: \`suppressions[${i}]\` must be an object with \`key\` and \`reason\`.`
      );
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== 'string') {
      throw new Error(`Config at ${configPath}: \`suppressions[${i}].key\` must be a string.`);
    }
    if (typeof e.reason !== 'string') {
      throw new Error(`Config at ${configPath}: \`suppressions[${i}].reason\` must be a string.`);
    }
    if (e.reviewedAt !== undefined && typeof e.reviewedAt !== 'string') {
      throw new Error(
        `Config at ${configPath}: \`suppressions[${i}].reviewedAt\` must be a string when present.`
      );
    }
  }
  return value as SchemaAuditConfig;
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
