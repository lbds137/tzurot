/**
 * Statically readable payload keys of object-literal option values for the
 * discord.js surface inventory: a literal's own keys, and the keys a local
 * variable holding a literal accumulates before a call. Anything the checker
 * cannot read records {@link UNKNOWN_PAYLOAD_KEY} instead of staying silent.
 */

import {
  Node,
  SyntaxKind,
  type BinaryExpression,
  type ElementAccessExpression,
  type Identifier,
  type ObjectLiteralExpression,
  type ObjectLiteralElement,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type ShorthandPropertyAssignment,
  type Symbol as TsMorphSymbol,
  type TypeChecker,
} from 'ts-morph';

/**
 * Marker key recorded for a call site whose payload is a value of a NAMED
 * interface / type alias that no literal in scope pins down (a parameter, a
 * variable without an object-literal initializer). The keys actually sent
 * are not statically known, so the site is made visible instead of omitted
 * or inflated to the full declared member list.
 */
export const UNKNOWN_PAYLOAD_KEY = '*';

/**
 * An object-literal KEY site: a property assignment or its shorthand
 * (`{ content }` — both kinds key the inventory identically via
 * `getName()`). Everything else `getProperties()` yields is not a key:
 * a SpreadAssignment (`...rest`) contributes no option key of its own,
 * and a method / accessor body is not an option key either.
 */
function isOptionKeyElement(
  property: ObjectLiteralElement
): property is PropertyAssignment | ShorthandPropertyAssignment {
  return Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property);
}

export function literalKeys(literal: ObjectLiteralExpression): string[] {
  return literal
    .getProperties()
    .filter(isOptionKeyElement)
    .map(property => property.getName());
}

/**
 * Keys a variable holding an object literal actually sends: the
 * initializer's keys, plus what every assignment in the variable's enclosing
 * function (or file) that textually PRECEDES the identifier being analysed
 * adds. An assignment after the call cannot have been sent by it.
 *
 * Two assignment shapes count:
 *  - `variable.key = …` / `variable['key'] = …` adds `key`; a nested write
 *    `variable.key.deep = …` adds the top-level `key`; a computed top-level
 *    element key (`variable[name] = …`) adds {@link UNKNOWN_PAYLOAD_KEY}
 *    (writes rooted at another variable add nothing);
 *  - a whole reassignment `variable = { … }` adds that literal's keys. A
 *    reassignment to anything that is not an object literal (a call, another
 *    identifier) cannot be read statically, so it adds
 *    {@link UNKNOWN_PAYLOAD_KEY} beside the keys already found — the gap
 *    stays visible instead of silent.
 *
 * Branches are not modelled: assignments in any branch before the call are
 * all counted (an over-approximation). Keys are deduped — a key set twice is
 * one key. Undefined when the identifier is not a variable initialized with
 * an object literal (the caller then falls back to the declared type).
 */
export function initializedVariableKeys(
  identifier: Identifier,
  typeChecker: TypeChecker
): string[] | undefined {
  const symbol = typeChecker.getSymbolAtLocation(identifier);
  const declaration = symbol?.getValueDeclaration();
  if (symbol === undefined || declaration === undefined) return undefined;
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  if (!Node.isObjectLiteralExpression(initializer)) return undefined;

  const keys = new Set(literalKeys(initializer));
  const scope = declaration.getFirstAncestor(
    ancestor => Node.isFunctionLikeDeclaration(ancestor) || Node.isSourceFile(ancestor)
  );
  for (const assignment of scope?.getDescendantsOfKind(SyntaxKind.BinaryExpression) ?? []) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    if (assignment.getStart() >= identifier.getStart()) continue;
    for (const key of assignedKeys(assignment, symbol, typeChecker)) keys.add(key);
  }
  return [...keys];
}

/**
 * Key one member access names: `.key` / `['key']` / `` [`key`] `` give `key`;
 * a computed element key (`[name]`, `[0]`) cannot be read statically and
 * gives {@link UNKNOWN_PAYLOAD_KEY}.
 */
function memberKey(access: PropertyAccessExpression | ElementAccessExpression): string {
  if (Node.isPropertyAccessExpression(access)) return access.getName();
  const argument = access.getArgumentExpression();
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralText();
  }
  return UNKNOWN_PAYLOAD_KEY;
}

/**
 * Keys one `=` assignment adds to `symbol`'s object: a member write
 * `symbol.key = …` / `symbol['key'] = …` (also nested — `symbol.key.deep = …`
 * and `symbol['key'].deep = …` add `key`; a computed top-level element key
 * adds {@link UNKNOWN_PAYLOAD_KEY}), or a whole `symbol = …` reassignment
 * (unreadable → {@link UNKNOWN_PAYLOAD_KEY}).
 */
export function assignedKeys(
  assignment: BinaryExpression,
  symbol: TsMorphSymbol,
  typeChecker: TypeChecker
): string[] {
  const target = assignment.getLeft();
  if (Node.isIdentifier(target)) {
    if (typeChecker.getSymbolAtLocation(target) !== symbol) return [];
    const assigned = assignment.getRight();
    return Node.isObjectLiteralExpression(assigned) ? literalKeys(assigned) : [UNKNOWN_PAYLOAD_KEY];
  }
  if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
    return [];
  }
  // Walk `a.b.c` / `a['b'].c` down to its root: a nested write still sets the
  // TOP-LEVEL key (`b`) on the tracked object, which is what the payload
  // carries. A non-null assertion (`a.b!.c`) is transparent: it does not
  // change the owner.
  let topLevel: PropertyAccessExpression | ElementAccessExpression = target;
  let root: Node = target.getExpression();
  while (
    Node.isPropertyAccessExpression(root) ||
    Node.isElementAccessExpression(root) ||
    Node.isNonNullExpression(root)
  ) {
    if (!Node.isNonNullExpression(root)) topLevel = root;
    root = root.getExpression();
  }
  if (!Node.isIdentifier(root)) return [];
  return typeChecker.getSymbolAtLocation(root) === symbol ? [memberKey(topLevel)] : [];
}
