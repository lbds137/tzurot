/**
 * Schema Audit — Finding generation
 *
 * Composes the read-mode + write-site classifications into audit findings,
 * one recipe per generator function. Recipes gate themselves on their own
 * preconditions; multiple recipes can fire on the same field.
 */

import type { PrismaField } from './schema-audit-parser.js';
import type { ReadModeClassification } from './schema-audit-reads.js';
import type { WriteSiteClassification } from './schema-audit-writes.js';

export interface AuditFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  recipe: string;
  model: string;
  field: string;
  evidence: string;
  fixShape: string;
}

/**
 * Generator-style `@default(...)` values where callers are expected to omit the
 * field (Prisma fills it in). Recipe Tertiary excludes fields with these defaults
 * because "always passed" wouldn't be true even if the column were appropriate.
 */
const GENERATOR_DEFAULT_PREFIXES = [
  'uuid(',
  'cuid(',
  'nanoid(',
  'now(',
  'autoincrement(',
  'dbgenerated(',
];

function isGeneratorDefault(defaultValue: string | null): boolean {
  if (defaultValue === null) return false;
  return GENERATOR_DEFAULT_PREFIXES.some(prefix => defaultValue.startsWith(prefix));
}

interface FindingsContext {
  reads: ReadModeClassification | undefined;
  writes: WriteSiteClassification | undefined;
  field: PrismaField;
}

/**
 * Recipe Primary (read-mode classification): >50% `??` reads → convenience-nullable
 * (MEDIUM); >50% non-null assertions → fake-optional (HIGH).
 */
function findingFromReads(ctx: FindingsContext): AuditFinding | null {
  const c = ctx.reads;
  if (!c || c.totalReads === 0) return null;

  const coalescingShare = c.nullishCoalescingReads / c.totalReads;
  const truthinessShare = c.truthinessGuardReads / c.totalReads;
  const assertionShare = c.nonNullAssertionReads / c.totalReads;

  if (assertionShare >= 0.5) {
    return {
      severity: 'HIGH',
      recipe: 'read-mode-classification',
      model: c.model,
      field: c.field,
      evidence: `${c.nonNullAssertionReads}/${c.totalReads} reads use non-null assertion (\`!\`). The TS code asserts presence, but the schema permits null — silent type-contract violation.`,
      fixShape: `Investigate: either tighten the schema to NOT NULL (with backfill migration) or fix the call sites to guard against null.`,
    };
  }
  if (coalescingShare >= 0.5 && coalescingShare > truthinessShare) {
    return {
      severity: 'MEDIUM',
      recipe: 'read-mode-classification',
      model: c.model,
      field: c.field,
      evidence: `${c.nullishCoalescingReads}/${c.totalReads} reads use \`?? fallback\`. The field has a meaningful default — null is convenience, not domain state.`,
      fixShape: `Backfill existing nulls with the canonical fallback value, then ALTER COLUMN SET NOT NULL + drop the \`?\` in schema.prisma. Resolver call sites become dead defensive code.`,
    };
  }
  return null;
}

/**
 * Recipe Secondary (bimodal-writes, Opus's Recipe 8): write sites split into
 * "always null/omit" and "always value" sets → caller identity encoded.
 */
function findingFromBimodalWrites(ctx: FindingsContext): AuditFinding | null {
  const w = ctx.writes;
  if (!w) return null;
  const nullOrOmitSites = w.nullLiteralSites + w.omittedSites;
  if (nullOrOmitSites < 2 || w.valueSites < 2) return null;
  return {
    severity: 'HIGH',
    recipe: 'bimodal-writes',
    model: w.model,
    field: w.field,
    evidence: `Writes split bimodally: ${nullOrOmitSites} sites pass \`null\`/omit (${w.nullLiteralSites} null + ${w.omittedSites} omitted), ${w.valueSites} sites pass a real value. The column is encoding caller identity in its nullability — same shape as the prior 4-month-bug class.`,
    fixShape: `Audit the null/omit call sites: are those callers conceptually a different entity from the real-value callers? Either (a) factor the entity split into the type system (separate models or discriminated union), or (b) backfill the null sites with sensible defaults and tighten to NOT NULL.`,
  };
}

/**
 * Recipe Tertiary (refined Recipe A — defaults-aware): all write sites pass
 * a real value, no null/omit anywhere, and there's no `@default(...)` to
 * explain why callers would skip it. The optionality is unused — a tightening
 * candidate without bimodal urgency.
 */
function findingFromAlwaysPassed(ctx: FindingsContext): AuditFinding | null {
  const w = ctx.writes;
  if (!w) return null;
  if (w.valueSites < 2) return null;
  if (w.nullLiteralSites > 0 || w.omittedSites > 0) return null;
  if (isGeneratorDefault(ctx.field.defaultValue)) return null;
  return {
    severity: 'MEDIUM',
    recipe: 'always-passed-no-default',
    model: w.model,
    field: w.field,
    evidence: `All ${w.valueSites} write sites pass a real value; no site passes null or omits the field. Schema has no \`@default\` to explain why callers might skip it. The optionality is unused.`,
    fixShape: `Confirm by reviewing each call site, then ALTER COLUMN SET NOT NULL and drop the \`?\` in schema.prisma.`,
  };
}

const RECIPES = [findingFromReads, findingFromBimodalWrites, findingFromAlwaysPassed] as const;

/**
 * Compose all recipes into the per-field finding set. Each recipe gates itself
 * on its own preconditions; multiple recipes can fire on the same field.
 */
export function generateFindings(
  readClassifications: ReadModeClassification[],
  writeClassifications: WriteSiteClassification[],
  fields: PrismaField[]
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const fieldByKey = new Map(fields.map(f => [`${f.model}.${f.field}`, f]));
  const readsByKey = new Map(readClassifications.map(c => [`${c.model}.${c.field}`, c]));
  const writesByKey = new Map(writeClassifications.map(w => [`${w.model}.${w.field}`, w]));

  for (const field of fields) {
    if (!field.optional) continue;
    const key = `${field.model}.${field.field}`;
    const ctx: FindingsContext = {
      reads: readsByKey.get(key),
      writes: writesByKey.get(key),
      field,
    };
    for (const recipe of RECIPES) {
      const result = recipe(ctx);
      if (result) findings.push(result);
    }
  }
  return findings.filter(f => fieldByKey.get(`${f.model}.${f.field}`)?.optional === true);
}
