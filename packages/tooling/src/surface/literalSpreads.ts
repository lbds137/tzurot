/**
 * Static reading of object-literal payloads and their spread operands, shared
 * by the surface analyzer's returned-literal and call-argument rules.
 */

import { Node, SyntaxKind, type ObjectLiteralExpression, type TypeChecker } from 'ts-morph';

import { initializedVariableKeys, literalKeys, UNKNOWN_PAYLOAD_KEY } from './payloadKeys.js';

/**
 * Keys of an object literal as returned from a function: its own keys plus
 * the keys of spread operands read by {@link spreadOperandKeys}: a local
 * object variable (`{ ...options, rest }`), `cond && { … }`, and a ternary
 * whose branches are each a literal, a literal-initialized variable, `null`
 * or `undefined`. A spread whose keys cannot be read statically (a call, a
 * member access, a parameter, a variable without an object-literal
 * initializer, a ternary with one unreadable branch, or a binary operator
 * other than `&&`) adds {@link UNKNOWN_PAYLOAD_KEY} beside the resolved keys
 * — never silent.
 */
export function returnedLiteralKeys(
  literal: ObjectLiteralExpression,
  typeChecker: TypeChecker
): string[] {
  const keys = new Set(literalKeys(literal));
  for (const property of literal.getProperties()) {
    if (!Node.isSpreadAssignment(property)) continue;
    const spreadKeys = spreadOperandKeys(property.getExpression(), typeChecker);
    for (const key of spreadKeys ?? [UNKNOWN_PAYLOAD_KEY]) keys.add(key);
  }
  return [...keys];
}

/** Keys of one spread operand, or undefined when they cannot be read statically. */
function spreadOperandKeys(expression: Node, typeChecker: TypeChecker): string[] | undefined {
  const operand = unwrapTransparent(expression);
  if (Node.isIdentifier(operand)) return initializedVariableKeys(operand, typeChecker);
  if (
    Node.isBinaryExpression(operand) &&
    operand.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
  ) {
    const right = unwrapTransparent(operand.getRight());
    return Node.isObjectLiteralExpression(right)
      ? returnedLiteralKeys(right, typeChecker)
      : undefined;
  }
  if (Node.isConditionalExpression(operand)) {
    const whenTrue = spreadBranchKeys(operand.getWhenTrue(), typeChecker);
    const whenFalse = spreadBranchKeys(operand.getWhenFalse(), typeChecker);
    if (whenTrue === undefined || whenFalse === undefined) return undefined;
    return [...new Set([...whenTrue, ...whenFalse])];
  }
  return undefined;
}

/** Keys of one ternary branch of a spread: a literal, `null` / `undefined` (no keys) or a variable; undefined when unreadable. */
function spreadBranchKeys(branch: Node, typeChecker: TypeChecker): string[] | undefined {
  const node = unwrapTransparent(branch);
  if (Node.isNullLiteral(node)) return [];
  if (Node.isIdentifier(node)) {
    return node.getText() === 'undefined' ? [] : initializedVariableKeys(node, typeChecker);
  }
  return Node.isObjectLiteralExpression(node) ? returnedLiteralKeys(node, typeChecker) : undefined;
}

/** Strip parentheses, `as`, `satisfies` and `!` — wrappers that change no runtime value. */
export function unwrapTransparent(expression: Node): Node {
  let current = expression;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}
