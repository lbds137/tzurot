/**
 * Type-checked analyzer for bot-client's discord.js API surface.
 *
 * Loads bot-client's tsconfig into a ts-morph Program and walks every scoped
 * source file, resolving each call / new / property-access / enum-member /
 * object-literal-key site to its DECLARATION and keeping the site only when
 * that declaration lives in the discord.js family of packages. Name-based
 * matching is deliberately absent: bot-client has local files that shadow
 * discord.js export names, and only declaration resolution can tell them
 * apart.
 */

import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  Node,
  Project,
  SymbolFlags,
  type ArrowFunction,
  type CallExpression,
  SyntaxKind,
  type Expression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Identifier,
  type NewExpression,
  type ObjectLiteralExpression,
  type Node as TsMorphNode,
  type ObjectLiteralElement,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type ShorthandPropertyAssignment,
  type SourceFile,
  type Symbol as TsMorphSymbol,
  type Type as TsMorphType,
  type TypeChecker,
} from 'ts-morph';

import { classify, compareSurfaceEntries, type ClassifiableHit } from './categories.js';
import type { SurfaceCategory, SurfaceEntry, SurfaceInventory } from './types.js';

/**
 * Declaration paths that count as the discord.js surface family. Covers the
 * pnpm-store shapes of discord.js itself, discord-api-types (where enum
 * members like MessageFlags resolve), and the @discordjs scoped packages
 * (builders, collection).
 */
const SURFACE_DECLARATION_FAMILY =
  /node_modules\/(discord\.js|discord-api-types|@discordjs\/[a-z-]+)\//;

/** Belt-and-braces test exclusion — the bot-client tsconfig already excludes tests; fixtures/mocks in tests must not enter the inventory. */
const TEST_FILE_PATTERN = /\.test\.ts$|\.spec\.ts$|\.mock\.ts$|\/src\/test\//;

/** Hostnames that mark a raw fetch/axios call as a Discord REST call outside the typed helpers. */
const DISCORD_API_HOSTS = new Set(['discord.com', 'discordapp.com']);

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** True when the declaration file belongs to the discord.js surface family. */
export function isSurfaceDeclarationPath(filePath: string): boolean {
  return SURFACE_DECLARATION_FAMILY.test(toPosix(filePath));
}

/**
 * Load bot-client's tsconfig as a Program and materialize its dependency
 * graph (node_modules declaration files included) so that declaration
 * resolution in {@link analyzeProject} can see where a symbol is declared.
 */
export function createBotClientProject(rootDir: string): Project {
  const project = new Project({
    tsConfigFilePath: join(rootDir, 'services/bot-client/tsconfig.json'),
  });
  project.resolveSourceFileDependencies();
  return project;
}

/**
 * Resolve a node to its discord.js-surface symbol, following import aliases
 * (an identifier referencing `import { X } from 'discord.js'` resolves to
 * the import specifier first; the declared class lives behind the alias).
 * Returns undefined when the node has no symbol, no declarations, or none
 * of them sit in the surface family.
 */
function resolveSurfaceSymbol(
  node: Expression,
  typeChecker: TypeChecker
): TsMorphSymbol | undefined {
  const sym = typeChecker.getSymbolAtLocation(node);
  if (sym === undefined) return undefined;
  const resolved =
    (sym.getFlags() & SymbolFlags.Alias) !== 0 ? typeChecker.getAliasedSymbol(sym) : sym;
  if (resolved === undefined) return undefined;
  const declarations = resolved.getDeclarations();
  if (declarations.length === 0) return undefined;
  if (declarations.some(decl => isSurfaceDeclarationPath(decl.getSourceFile().getFilePath()))) {
    return resolved;
  }
  return undefined;
}

/** Symbol name of the receiver type for `obj.member` expressions (e.g. 'Webhook'), when resolvable. */
function resolveReceiverTypeName(
  expression: Expression,
  typeChecker: TypeChecker
): string | undefined {
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  return typeChecker.getTypeAtLocation(expression.getExpression()).getSymbol()?.getName();
}

/**
 * Container name of an enum-member declaration. An EnumMember's parent is
 * always its EnumDeclaration (TS grammar), and the sole call site guards on
 * `Node.isEnumMember` — no rewrapped-member walk exists to cover.
 */
function resolveContainerName(member: Node): string | undefined {
  const parent = member.getParent();
  return Node.isEnumDeclaration(parent) ? parent.getName() : undefined;
}

/** Literal URL text from the first call argument — string and template literals only. */
function extractLiteralUrl(argument: TsMorphNode | undefined): string | undefined {
  if (argument === undefined) return undefined;
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralText();
  }
  if (Node.isTemplateExpression(argument)) {
    // Placeholder 'x' stands in for each hole, keeping scheme+host parseable.
    let text = argument.getHead().getLiteralText();
    for (const span of argument.getTemplateSpans()) {
      text += '${x}' + span.getLiteral().getLiteralText();
    }
    return text;
  }
  return undefined;
}

/**
 * rest-outside-helpers detection: a bare `fetch('https://discord.com/…')` or
 * `axios.get('https://discord.com/…')` call bypassing the typed REST
 * helpers. Host comparison parses with `new URL()` and compares `.hostname`
 * with `===` (never substring matching). Sees string-literal URLs only — a
 * URL assembled at runtime is invisible to this category.
 */
function tryRecordRestOutsideHelper(
  call: CallExpression,
  record: (symbolName: string) => void
): void {
  const callee = call.getExpression();
  let calleeText: string;
  if (Node.isIdentifier(callee) && callee.getText() === 'fetch') {
    calleeText = 'fetch';
  } else if (
    Node.isPropertyAccessExpression(callee) &&
    Node.isIdentifier(callee.getExpression()) &&
    callee.getExpression().getText() === 'axios'
  ) {
    calleeText = callee.getText();
  } else {
    return;
  }
  const urlText = extractLiteralUrl(call.getArguments()[0]);
  if (urlText === undefined) return;
  let hostname: string;
  try {
    hostname = new URL(urlText).hostname;
  } catch {
    // not an absolute URL — skip
    return;
  }
  if (DISCORD_API_HOSTS.has(hostname)) record(calleeText);
}

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

function literalKeys(literal: ObjectLiteralExpression): string[] {
  return literal
    .getProperties()
    .filter(isOptionKeyElement)
    .map(property => property.getName());
}

/**
 * Keys a variable holding an object literal actually sends: the
 * initializer's keys plus every `variable.key = …` assignment in the
 * variable's enclosing function (or file) that textually PRECEDES the
 * identifier being analysed (an assignment after the call cannot have been
 * sent by it). Deduped — a key set twice is one key. Undefined when the identifier is not a variable initialized with an
 * object literal (the caller then falls back to the declared type).
 */
function initializedVariableKeys(
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
    const target = assignment.getLeft();
    if (!Node.isPropertyAccessExpression(target)) continue;
    const owner = target.getExpression();
    if (!Node.isIdentifier(owner)) continue;
    if (assignment.getStart() >= identifier.getStart()) continue;
    if (typeChecker.getSymbolAtLocation(owner) === symbol) keys.add(target.getName());
  }
  return [...keys];
}

/** A property is a payload key unless it is a method or comes from a non-surface declaration file (lib / @types, e.g. Buffer's `length`). */
function isPayloadProperty(property: TsMorphSymbol): boolean {
  const declarations = property.getDeclarations();
  if (declarations.every(d => Node.isMethodSignature(d) || Node.isMethodDeclaration(d))) {
    return false;
  }
  return declarations.some(d => {
    const sourceFile = d.getSourceFile();
    return !sourceFile.isDeclarationFile() || isSurfaceDeclarationPath(sourceFile.getFilePath());
  });
}

/**
 * Marker key recorded for a call site whose payload is a value of a NAMED
 * interface / type alias that no literal in scope pins down (a parameter, a
 * variable without an object-literal initializer). The keys actually sent
 * are not statically known, so the site is made visible instead of omitted
 * or inflated to the full declared member list.
 */
export const UNKNOWN_PAYLOAD_KEY = '*';

/** A declared (interface or type-alias) type, as opposed to one inferred from a literal or written inline. */
function isNamedDeclaredType(type: TsMorphType): boolean {
  if (type.getAliasSymbol() !== undefined) return true;
  return (type.getSymbol()?.getDeclarations() ?? []).some(d => Node.isInterfaceDeclaration(d));
}

/**
 * Payload keys of an expression that no literal pins down. Class instances
 * (builders, Collections), arrays, functions and primitives are not payload
 * objects and contribute nothing. An anonymous object type (inferred from a
 * literal, or written inline) contributes its properties; a named
 * interface / alias contributes only {@link UNKNOWN_PAYLOAD_KEY}.
 */
function typedPayloadKeys(argument: Node, typeChecker: TypeChecker): string[] {
  const type = typeChecker.getTypeAtLocation(argument).getNonNullableType();
  if (type.isUnion()) return compositePayloadKeys(type, type.getUnionTypes());
  if (type.isIntersection()) return compositePayloadKeys(type, type.getIntersectionTypes());
  if (!isPayloadObject(type)) return [];
  const names = payloadPropertyNames(type);
  if (names.length === 0) return [];
  return isNamedDeclaredType(type) ? [UNKNOWN_PAYLOAD_KEY] : names;
}

/**
 * Payload keys of a union / intersection. Primitive / null-ish only members
 * (including `boolean`) are no payload; any named or non-payload-object
 * constituent leaves the sent keys unknown; otherwise the keys are the
 * union of every (anonymous) constituent's properties.
 */
function compositePayloadKeys(type: TsMorphType, parts: TsMorphType[]): string[] {
  if (!parts.some(part => part.isObject())) return [];
  if (!parts.every(isAnonymousPayloadObject)) return [UNKNOWN_PAYLOAD_KEY];
  const names = type.isUnion()
    ? parts.flatMap(part => payloadPropertyNames(part))
    : payloadPropertyNames(type);
  return [...new Set(names)];
}

/** A plain object type: not a class instance, array or function. */
function isPayloadObject(type: TsMorphType): boolean {
  // A generic class instance (ActionRowBuilder<T>) is a reference whose
  // TARGET is the class, so isClass() must be asked of the target too.
  if (!type.isObject() || type.isArray() || (type.getTargetType() ?? type).isClass()) return false;
  return type.getCallSignatures().length === 0 && type.getConstructSignatures().length === 0;
}

function isAnonymousPayloadObject(type: TsMorphType): boolean {
  return isPayloadObject(type) && !isNamedDeclaredType(type);
}

function payloadPropertyNames(type: TsMorphType): string[] {
  return type
    .getProperties()
    .filter(isPayloadProperty)
    .map(property => property.getName());
}

/** Keys of an object literal as returned from a function: its own keys plus the keys of spread local object variables (`{ ...options, rest }`). */
function returnedLiteralKeys(literal: ObjectLiteralExpression, typeChecker: TypeChecker): string[] {
  const keys = new Set(literalKeys(literal));
  for (const property of literal.getProperties()) {
    if (!Node.isSpreadAssignment(property)) continue;
    const spread = property.getExpression();
    if (!Node.isIdentifier(spread)) continue;
    for (const key of initializedVariableKeys(spread, typeChecker) ?? []) keys.add(key);
  }
  return [...keys];
}

/** Keys of one returned expression: a literal (conditional branches included) or a local variable. */
function collectReturnedKeys(expression: Node, typeChecker: TypeChecker): string[] {
  if (Node.isObjectLiteralExpression(expression)) {
    return returnedLiteralKeys(expression, typeChecker);
  }
  if (Node.isIdentifier(expression)) return initializedVariableKeys(expression, typeChecker) ?? [];
  if (Node.isConditionalExpression(expression)) {
    return [
      ...collectReturnedKeys(expression.getWhenTrue(), typeChecker),
      ...collectReturnedKeys(expression.getWhenFalse(), typeChecker),
    ];
  }
  if (Node.isParenthesizedExpression(expression)) {
    return collectReturnedKeys(expression.getExpression(), typeChecker);
  }
  return [];
}

/** The in-project function-like node a call expression invokes, when resolvable. */
function resolveCalleeFunction(
  call: CallExpression,
  typeChecker: TypeChecker
): FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | undefined {
  let symbol = typeChecker.getSymbolAtLocation(call.getExpression());
  if (symbol !== undefined && (symbol.getFlags() & SymbolFlags.Alias) !== 0) {
    symbol = typeChecker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.getValueDeclaration();
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile()) {
    return undefined;
  }
  const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  if (fn === undefined) return undefined;
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isArrowFunction(fn) ||
    Node.isFunctionExpression(fn)
  ) {
    return fn;
  }
  return undefined;
}

/**
 * Keys returned by the in-project function a call expression invokes: the
 * object literals in its `return` statements (spread locals included) and a
 * returned local variable resolved like rule 2. Empty when the callee is
 * out-of-project, unresolvable, or returns no literal.
 */
function callReturnKeys(call: CallExpression, typeChecker: TypeChecker): string[] {
  const fn = resolveCalleeFunction(call, typeChecker);
  if (fn === undefined) return [];
  const body = fn.getBody();
  if (body === undefined) return [];
  const returned: Node[] = [];
  if (Node.isBlock(body)) {
    for (const ret of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      // only this function's own returns, not those of nested functions
      if (ret.getFirstAncestor(a => Node.isFunctionLikeDeclaration(a)) !== fn) continue;
      const expression = ret.getExpression();
      if (expression !== undefined) returned.push(expression);
    }
  } else {
    returned.push(body);
  }
  return [...new Set(returned.flatMap(expression => collectReturnedKeys(expression, typeChecker)))];
}

/**
 * Option keys contributed by one call / new argument — the keys the code
 * actually sends, never a whole declared member list:
 *  1. an object literal contributes its own keys;
 *  2. an identifier bound to a variable initialized with an object literal
 *     contributes the initializer's keys plus the `variable.key = …`
 *     assignments in the same function that precede the call;
 *  3. a call expression contributes the keys of the object literals its
 *     in-project callee returns (see {@link callReturnKeys});
 *  4. any other expression is judged by its checked type: an anonymous object
 *     type contributes its properties, a NAMED interface / alias contributes
 *     the single {@link UNKNOWN_PAYLOAD_KEY} marker.
 */
function collectOptionKeys(argument: Node, typeChecker: TypeChecker): string[] {
  if (Node.isObjectLiteralExpression(argument)) return literalKeys(argument);
  if (Node.isIdentifier(argument)) {
    const keys = initializedVariableKeys(argument, typeChecker);
    if (keys !== undefined) return keys;
  }
  if (Node.isCallExpression(argument)) return callReturnKeys(argument, typeChecker);
  return typedPayloadKeys(argument, typeChecker);
}

/**
 * Walk one scoped source file, recording every discord.js-surface site into
 * `hits`. The call / new / property-access branches are mutually exclusive
 * per node; the property-access branch skips members already owned by the
 * call / new branches so no site counts twice.
 */
function walkFile(
  sourceFile: SourceFile,
  rootDir: string,
  typeChecker: TypeChecker,
  hits: Map<string, SurfaceEntry>
): void {
  const file = toPosix(relative(rootDir, sourceFile.getFilePath()));

  function record(hit: ClassifiableHit, categoryOverride?: SurfaceCategory): void {
    const category = categoryOverride ?? classify(hit);
    const key = `${category}|${file}|${hit.symbolName}`;
    const existing = hits.get(key);
    if (existing === undefined) {
      hits.set(key, { category, file, symbol: hit.symbolName, count: 1 });
      return;
    }
    existing.count += 1;
  }

  function handleCall(node: CallExpression): void {
    const callee = node.getExpression();
    const sym = resolveSurfaceSymbol(callee, typeChecker);
    if (sym !== undefined) {
      const receiverTypeName = resolveReceiverTypeName(callee, typeChecker);
      const callName = sym.getName();
      record({ kind: 'call', symbolName: callName, receiverTypeName });
      for (const argument of node.getArguments()) {
        for (const key of collectOptionKeys(argument, typeChecker)) {
          record({ kind: 'option-key', symbolName: key, receiverTypeName, callName });
        }
      }
    } else {
      tryRecordRestOutsideHelper(node, symbolName =>
        record({ kind: 'call', symbolName }, 'rest-outside-helpers')
      );
    }
  }

  function handleNew(node: NewExpression): void {
    const sym = resolveSurfaceSymbol(node.getExpression(), typeChecker);
    if (sym === undefined) return;
    const className = sym.getName();
    record({ kind: 'new', symbolName: className });
    const [firstArgument] = node.getArguments();
    if (firstArgument === undefined) return;
    for (const key of collectOptionKeys(firstArgument, typeChecker)) {
      record({ kind: 'option-key', symbolName: key, receiverTypeName: className });
    }
  }

  function handlePropertyAccess(node: PropertyAccessExpression): void {
    const parent = node.getParent();
    if (
      (Node.isCallExpression(parent) || Node.isNewExpression(parent)) &&
      parent.getExpression() === node
    ) {
      return;
    }
    const sym = resolveSurfaceSymbol(node, typeChecker);
    if (sym === undefined) return;
    const firstDeclaration = sym.getDeclarations()[0];
    if (firstDeclaration !== undefined && Node.isEnumMember(firstDeclaration)) {
      const containerName = resolveContainerName(firstDeclaration);
      record({
        kind: 'enum-member',
        // Container-qualify when the container resolves so distinct enums'
        // same-named members cannot merge in the snapshot key.
        symbolName:
          containerName === undefined ? sym.getName() : `${containerName}.${sym.getName()}`,
        containerName,
      });
      return;
    }
    record({
      kind: 'property-access',
      symbolName: sym.getName(),
      receiverTypeName: resolveReceiverTypeName(node, typeChecker),
    });
  }

  sourceFile.forEachDescendant(node => {
    if (Node.isCallExpression(node)) {
      handleCall(node);
    } else if (Node.isNewExpression(node)) {
      handleNew(node);
    } else if (Node.isPropertyAccessExpression(node)) {
      handlePropertyAccess(node);
    }
  });
}

/**
 * Walk the project's bot-client source files and return the aggregated,
 * sorted surface entries. Sort order: category, then file, then symbol
 * (plain string comparison — deterministic across runs).
 */
export function analyzeProject(project: Project, rootDir: string): SurfaceEntry[] {
  const scopePrefix = `${toPosix(join(rootDir, 'services/bot-client/src'))}/`;
  const scoped = project
    .getSourceFiles()
    .filter(
      sourceFile =>
        sourceFile.getFilePath().startsWith(scopePrefix) &&
        !TEST_FILE_PATTERN.test(sourceFile.getFilePath())
    );
  if (scoped.length === 0) {
    throw new Error(`surface inventory scope is empty (no source files under ${scopePrefix})`);
  }

  const hits = new Map<string, SurfaceEntry>();
  const typeChecker = project.getTypeChecker();
  for (const sourceFile of scoped) {
    walkFile(sourceFile, rootDir, typeChecker, hits);
  }
  return [...hits.values()].sort(compareSurfaceEntries);
}

/** Analyze bot-client in the repo at `rootDir`, with wall-clock timing. */
export async function analyzeBotClient(rootDir: string): Promise<SurfaceInventory> {
  const startedAt = performance.now();
  const project = createBotClientProject(rootDir);
  const entries = analyzeProject(project, rootDir);
  const elapsedMs = performance.now() - startedAt;
  const totalSites = entries.reduce((sum, entry) => sum + entry.count, 0);
  return { entries, totalSites, elapsedMs };
}
