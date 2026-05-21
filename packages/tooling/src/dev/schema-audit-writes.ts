/**
 * Schema Audit — Write-site classification (Recipes Secondary + Tertiary)
 *
 * Walks `prisma.<model>.create({ data })` and `prisma.<model>.upsert({ create })`
 * calls. For each tracked optional field, classifies the value passed at each
 * site: `null-literal` / `value` / `omitted` / `unclassifiable`.
 *
 * Powers two recipes:
 * - Bimodal-writes (Opus's "Recipe 8"): sites split into ≥2 null/omit + ≥2 value
 *   clusters → caller identity encoded in nullability (the original 4-month-bug
 *   pattern).
 * - Always-passed-no-default: every site passes a value + no `@default` →
 *   optionality is unused.
 */

import {
  Project,
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
} from 'ts-morph';
import type { PrismaField } from './schema-audit-parser.js';

/**
 * Write-site classification for a single optional column. Counts Prisma
 * `.create()` and `.upsert({ create: ... })` sites by how each one populates
 * the field — the basis for Recipe Secondary (bimodal-writes detection).
 */
export interface WriteSiteClassification {
  model: string;
  field: string;
  /** Sites where the field is explicitly passed as `null`. */
  nullLiteralSites: number;
  /** Sites where the field is passed as a non-null expression (variable, literal, call, etc.). */
  valueSites: number;
  /** Sites where the field is omitted entirely from the `data` object. */
  omittedSites: number;
  /** Sites where classification was impossible (spread, computed, dynamic). */
  unclassifiableSites: number;
  /**
   * Total `.create`/`.upsert.create` call sites observed for this field's
   * model. Per-model, not per-field — every `WriteSiteClassification` whose
   * `model` matches will report the same value here, since the count is
   * derived from the model's call sites regardless of which field is observed.
   */
  totalSites: number;
}

/** Per-field write-site outcome for one `.create` / `.upsert.create` invocation. */
type WriteOutcome = 'null' | 'value' | 'omitted' | 'unclassifiable';

/** Lowercase the first character (Prisma client convention: `User` → `user`). */
function modelAccessorName(modelName: string): string {
  return modelName.length === 0 ? '' : modelName[0].toLowerCase() + modelName.slice(1);
}

/**
 * Classify how a single object-literal property populates a field.
 * Returns `omitted` if the property is missing entirely.
 * Returns `unclassifiable` for spread elements, computed keys, etc.
 */
function classifyDataProperty(
  dataObject: Node,
  fieldName: string,
  hasSpread: boolean
): WriteOutcome {
  if (!Node.isObjectLiteralExpression(dataObject)) {
    return 'unclassifiable';
  }
  for (const prop of dataObject.getProperties()) {
    const outcome = classifyProperty(prop, fieldName);
    if (outcome !== null) return outcome;
  }
  return hasSpread ? 'unclassifiable' : 'omitted';
}

/**
 * Classify a single object-literal property against a target field name.
 * Returns null if the property is unrelated (caller continues searching).
 *
 * The initializer expression is treated as `null` not just when it's the
 * literal `null` keyword, but also when its top-level operator is `??` with
 * a `null` right-hand side (or `|| null`, `|| undefined`) — those patterns
 * acknowledge that the value MAY be null at runtime, which is the property
 * the bimodal-writes and always-passed-no-default recipes care about. A
 * caller writing `field: data.x ?? null` is NOT making a "this is always a
 * real value" assertion, so it shouldn't be in the value-set.
 */
function classifyProperty(prop: Node, fieldName: string): WriteOutcome | null {
  if (Node.isPropertyAssignment(prop)) {
    const nameNode = prop.getNameNode();
    if (!Node.isIdentifier(nameNode) || nameNode.getText() !== fieldName) return null;
    const initializer = prop.getInitializer();
    if (initializer === undefined) return 'unclassifiable';
    return classifyInitializer(initializer);
  }
  if (Node.isShorthandPropertyAssignment(prop) && prop.getName() === fieldName) {
    return 'value';
  }
  return null;
}

/**
 * Classify an initializer expression as null-yielding or value-yielding.
 * Recognises common nullable-fallback patterns syntactically — full
 * type-resolution would catch more cases but adds AST complexity.
 */
function classifyInitializer(initializer: Node): WriteOutcome {
  if (initializer.getText() === 'null') return 'null';
  // Prisma treats `{ field: undefined }` identically to omitting the key,
  // so bare `undefined` belongs in the `omitted` bucket — not `value`.
  if (initializer.getText() === 'undefined') return 'omitted';
  if (initializer.getKind() === SyntaxKind.BinaryExpression) {
    const binary = initializer.asKindOrThrow(SyntaxKind.BinaryExpression);
    const op = binary.getOperatorToken().getText();
    if (op === '??' || op === '||') {
      const rhsText = binary.getRight().getText();
      if (rhsText === 'null' || rhsText === 'undefined') {
        // Caller acknowledges the value may be null/undefined — treat as null
        // for recipe purposes (same bucket as omitted from a "would tightening
        // be safe?" perspective).
        return 'null';
      }
    }
  }
  return 'value';
}

/**
 * Walk source files looking for `prisma.<model>.create({ data: {...} })` and
 * `prisma.<model>.upsert({ ..., create: {...} })` invocations. Classify each
 * tracked optional field at each invocation site.
 */
export function analyzeWrites(
  optionalFields: PrismaField[],
  sourceFilePaths: string[]
): WriteSiteClassification[] {
  const project = new Project({
    compilerOptions: { allowJs: false, skipLibCheck: true },
    useInMemoryFileSystem: false,
  });
  for (const path of sourceFilePaths) {
    project.addSourceFileAtPathIfExists(path);
  }

  const classifications = new Map<string, WriteSiteClassification>();
  for (const field of optionalFields) {
    classifications.set(`${field.model}.${field.field}`, {
      model: field.model,
      field: field.field,
      nullLiteralSites: 0,
      valueSites: 0,
      omittedSites: 0,
      unclassifiableSites: 0,
      totalSites: 0,
    });
  }

  // Group optional fields by Prisma model accessor name (lowercase first char)
  // to avoid an O(models × calls) scan per source file.
  const fieldsByAccessor = new Map<string, PrismaField[]>();
  for (const field of optionalFields) {
    const accessor = modelAccessorName(field.model);
    const list = fieldsByAccessor.get(accessor) ?? [];
    list.push(field);
    fieldsByAccessor.set(accessor, list);
  }

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant(node => {
      if (!Node.isCallExpression(node)) return;
      visitCallExpression(node, fieldsByAccessor, classifications);
    });
  }

  return Array.from(classifications.values());
}

/**
 * Extract the data-object literal from a Prisma write call. Returns
 * { dataObject, modelFields } if the call matches the expected shape;
 * null otherwise. The matched call must be `<receiver>.<modelAccessor>.<create|upsert>`
 * with an object-literal first argument containing a `data` (create) or
 * `create` (upsert) property pointing to an object literal.
 */
function extractCreateData(
  call: CallExpression,
  fieldsByAccessor: Map<string, PrismaField[]>
): { dataObject: ObjectLiteralExpression; modelFields: PrismaField[] } | null {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const methodName = callee.getName();
  if (methodName !== 'create' && methodName !== 'upsert') return null;

  const receiver = callee.getExpression();
  if (!Node.isPropertyAccessExpression(receiver)) return null;
  const accessor = receiver.getName();
  const modelFields = fieldsByAccessor.get(accessor);
  if (!modelFields || modelFields.length === 0) return null;

  const [arg] = call.getArguments();
  if (arg === undefined || !Node.isObjectLiteralExpression(arg)) return null;

  const propertyName = methodName === 'create' ? 'data' : 'create';
  const dataProperty = arg.getProperty(propertyName);
  if (dataProperty === undefined || !Node.isPropertyAssignment(dataProperty)) return null;
  const dataObject = dataProperty.getInitializer();
  if (dataObject === undefined || !Node.isObjectLiteralExpression(dataObject)) return null;

  return { dataObject, modelFields };
}

function visitCallExpression(
  call: CallExpression,
  fieldsByAccessor: Map<string, PrismaField[]>,
  classifications: Map<string, WriteSiteClassification>
): void {
  const matched = extractCreateData(call, fieldsByAccessor);
  if (matched === null) return;
  const { dataObject, modelFields } = matched;
  const hasSpread = dataObject.getProperties().some(p => Node.isSpreadAssignment(p));

  for (const field of modelFields) {
    const classification = classifications.get(`${field.model}.${field.field}`);
    if (!classification) continue;
    classification.totalSites += 1;
    const outcome = classifyDataProperty(dataObject, field.field, hasSpread);
    if (outcome === 'null') classification.nullLiteralSites += 1;
    else if (outcome === 'value') classification.valueSites += 1;
    else if (outcome === 'omitted') classification.omittedSites += 1;
    else classification.unclassifiableSites += 1;
  }
}
