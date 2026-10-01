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
  type CallExpression,
  type Expression,
  type NewExpression,
  type Node as TsMorphNode,
  type ObjectLiteralElement,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type ShorthandPropertyAssignment,
  type SourceFile,
  type Symbol as TsMorphSymbol,
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
const TEST_FILE_PATTERN = /\.test\.ts$|\.spec\.ts$/;

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
      record({ kind: 'call', symbolName: sym.getName(), receiverTypeName });
      for (const argument of node.getArguments()) {
        if (!Node.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.getProperties()) {
          if (!isOptionKeyElement(property)) continue;
          record({ kind: 'option-key', symbolName: property.getName(), receiverTypeName });
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
    if (!Node.isObjectLiteralExpression(firstArgument)) return;
    for (const property of firstArgument.getProperties()) {
      if (!isOptionKeyElement(property)) continue;
      record({ kind: 'option-key', symbolName: property.getName(), receiverTypeName: className });
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
