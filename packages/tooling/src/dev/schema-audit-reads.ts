/**
 * Schema Audit — Read-mode classification (Recipe Primary)
 *
 * Per Opus 4.7's heuristic: for each optional Prisma column, walk every TS
 * `obj.field` access. Classify reads into:
 * - `?? fallback` → convenience-nullable signal
 * - `!= null` / truthiness guards → state-machine signal
 * - `!` non-null assertions → fake-optional signal (HIGH severity)
 *
 * The model is matched on the IDENTIFIER name of the receiver (e.g., `user.x`
 * matches model `User`). Milestone-1 heuristic doesn't do full type resolution;
 * upgrade later if false-positive rate is too high.
 */

import { SyntaxKind, Node, type Project, type PropertyAccessExpression } from 'ts-morph';
import type { PrismaField } from './schema-audit-parser.js';

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

/**
 * Walk an already-parsed project's source files and classify reads of
 * `obj.field` for each given (model, field) pair. Takes a `Project` (see
 * `globSourceFiles`) so the tree is parsed once per audit run, not per pass.
 */
export function classifyReads(
  optionalFields: PrismaField[],
  project: Project
): ReadModeClassification[] {
  const classifications = new Map<string, ReadModeClassification>();
  for (const field of optionalFields) {
    classifications.set(`${field.model}.${field.field}`, {
      model: field.model,
      field: field.field,
      nullishCoalescingReads: 0,
      truthinessGuardReads: 0,
      nonNullAssertionReads: 0,
      totalReads: 0,
    });
  }

  // Index by field name so each property access checks only its candidate
  // fields — mirrors analyzeWrites' accessor grouping (the inner linear scan
  // was O(propAccesses × optionalFields)).
  const fieldsByName = new Map<string, PrismaField[]>();
  for (const field of optionalFields) {
    const list = fieldsByName.get(field.field) ?? [];
    list.push(field);
    fieldsByName.set(field.field, list);
  }

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant(node => {
      if (!Node.isPropertyAccessExpression(node)) return;
      const receiver = node.getExpression();
      if (!Node.isIdentifier(receiver)) return;
      const receiverName = receiver.getText();
      const fieldName = node.getName();

      for (const field of fieldsByName.get(fieldName) ?? []) {
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

/** Heuristic: does `receiverName` likely refer to the given model? */
function matchesModel(receiverName: string, model: string): boolean {
  const lowerReceiver = receiverName.toLowerCase();
  const lowerModel = model.toLowerCase();
  return lowerReceiver === lowerModel || lowerReceiver === `${lowerModel}s`;
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

// Parent kinds where `obj.field` IS the condition itself (no further checking needed).
// `IfStatement.expression` / `WhileStatement.expression` / `DoStatement.expression`
// are always truthiness contexts when the property access is their direct child.
// (`PrefixUnaryExpression` is NOT in this set — only the `!` operator is a
// truthiness guard; `+x.field`, `-x.field`, `~x.field` are arithmetic coercions
// and shouldn't count.)
const UNCONDITIONAL_TRUTHINESS_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
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
  if (parentKind === SyntaxKind.ConditionalExpression) {
    // `cond ? whenTrue : whenFalse` — only count if `node` is the condition.
    // Reads in the consequence/alternate branches are accesses, not guards.
    const ternary = parent.asKindOrThrow(SyntaxKind.ConditionalExpression);
    if (ternary.getCondition() === node) {
      classification.truthinessGuardReads += 1;
    }
    return;
  }
  if (parentKind === SyntaxKind.PrefixUnaryExpression) {
    // Only `!x.field` is a truthiness guard. `+`, `-`, `~` are arithmetic
    // coercion operators — the property access is being read for its value,
    // not for presence.
    const prefix = parent.asKindOrThrow(SyntaxKind.PrefixUnaryExpression);
    if (prefix.getOperatorToken() === SyntaxKind.ExclamationToken) {
      classification.truthinessGuardReads += 1;
    }
    return;
  }
  if (UNCONDITIONAL_TRUTHINESS_KINDS.has(parentKind)) {
    classification.truthinessGuardReads += 1;
  }
}
