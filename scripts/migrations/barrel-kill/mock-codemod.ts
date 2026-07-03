/**
 * Barrel-kill codemod — test-mock half.
 *
 * `vi.mock(spec)` intercepts ONLY imports of the exact `spec`. Once production
 * imports move to deep subpaths, a `vi.mock('@tzurot/common-types', factory)`
 * intercepts nothing the subject imports — so each mock must be re-pointed at
 * the subpath(s) of the symbols it OVERRIDES. Non-overridden symbols now resolve
 * from their own (un-mocked) subpaths to the REAL module, so:
 *   - identity passthroughs (`X: actual.X`) are DROPPED (they resolve real), and
 *   - the `...actual` spread is mirrored per emitted group (each group spreads
 *     its OWN subpath's real module).
 *
 * The repo's mocks come in exactly two shapes (measured): partial (spread
 * `...actual` + a few overrides) and full-replacement (no spread). Anything that
 * doesn't parse to one of those — or an override body that reaches ACROSS
 * subpaths via `actual.foo` — is FLAGGED and left untouched for manual handling,
 * never silently mangled.
 */

import {
  SyntaxKind,
  type SourceFile,
  type Node,
  type ObjectLiteralExpression,
  type CallExpression,
} from 'ts-morph';
import type { SymbolMap } from './build-symbol-map.js';

const PACKAGE = '@tzurot/common-types';

export interface MockReport {
  mocksRewritten: number;
  mockGroupsEmitted: number;
  flagged: string[]; // files/sites needing manual handling
  unresolved: string[];
}

interface FactoryShape {
  returnObj: ObjectLiteralExpression;
  actualBinding: string | undefined; // name bound to importOriginal()/importActual()
  hadSpread: boolean;
  usesImportActual: boolean; // vi.importActual(...) vs importOriginal(...)
  paramName: string | undefined; // the arrow param (importOriginal)
}

/** Locate `vi.mock('@tzurot/common-types', <factory>)` call expressions. */
function findBarrelMockCalls(sf: SourceFile): CallExpression[] {
  return sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter(call => {
    const expr = call.getExpression();
    if (expr.getText() !== 'vi.mock') return false;
    const arg0 = call.getArguments()[0];
    return (
      arg0 !== undefined && arg0.asKind(SyntaxKind.StringLiteral)?.getLiteralValue() === PACKAGE
    );
  });
}

/** Find the object literal a factory returns (arrow-expr body or block `return`). */
function getReturnObject(factory: Node): ObjectLiteralExpression | undefined {
  const arrow =
    factory.asKind(SyntaxKind.ArrowFunction) ?? factory.asKind(SyntaxKind.FunctionExpression);
  if (arrow === undefined) return undefined;
  const body = arrow.getBody();
  const paren = body.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren !== undefined) return paren.getExpression().asKind(SyntaxKind.ObjectLiteralExpression);
  const block = body.asKind(SyntaxKind.Block);
  if (block === undefined) return undefined;
  const ret = block.getStatements().find(s => s.getKind() === SyntaxKind.ReturnStatement);
  return ret
    ?.asKind(SyntaxKind.ReturnStatement)
    ?.getExpression()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
}

/** Parse the factory into a normalized shape, or undefined if unrecognized. */
function analyzeFactory(factory: Node): FactoryShape | undefined {
  const returnObj = getReturnObject(factory);
  if (returnObj === undefined) return undefined;

  const arrow =
    factory.asKind(SyntaxKind.ArrowFunction) ?? factory.asKind(SyntaxKind.FunctionExpression);
  const paramName = arrow?.getParameters()[0]?.getName();

  // Spread: any `...expr` in the returned object.
  const spread = returnObj.getProperties().find(p => p.getKind() === SyntaxKind.SpreadAssignment);
  const hadSpread = spread !== undefined;

  // Find the `const <name> = await (importOriginal|vi.importActual)(...)` binding.
  let actualBinding: string | undefined;
  let usesImportActual = false;
  const block = arrow?.getBody().asKind(SyntaxKind.Block);
  if (block !== undefined) {
    for (const stmt of block.getStatements()) {
      const varDecl = stmt.asKind(SyntaxKind.VariableStatement)?.getDeclarations()[0];
      const init = varDecl?.getInitializer();
      const inner = init?.asKind(SyntaxKind.AwaitExpression)?.getExpression() ?? init;
      const callText = inner?.asKind(SyntaxKind.CallExpression)?.getExpression().getText();
      if (callText === undefined) continue;
      if (
        callText === paramName ||
        callText.includes('importActual') ||
        callText.includes('importOriginal')
      ) {
        actualBinding = varDecl?.getName();
        usesImportActual = callText.includes('importActual');
        break;
      }
    }
  }
  return { returnObj, actualBinding, hadSpread, usesImportActual, paramName };
}

interface OverrideProp {
  text: string; // full property text, e.g. `createLogger: () => ({...})`
  subpath: string;
}

/** Is `node` exactly `<actualBinding>.<name>` (identity passthrough)? */
function isIdentityPassthrough(
  valueNode: Node | undefined,
  key: string,
  actualBinding: string | undefined
): boolean {
  if (valueNode === undefined || actualBinding === undefined) return false;
  const pae = valueNode.asKind(SyntaxKind.PropertyAccessExpression);
  if (pae === undefined) return false;
  return pae.getExpression().getText() === actualBinding && pae.getName() === key;
}

/** Does a value body reach `actualBinding.<foo>` where foo lives in ANOTHER subpath? */
function hasCrossSubpathActualRef(
  valueNode: Node | undefined,
  actualBinding: string | undefined,
  ownSubpath: string,
  map: SymbolMap
): boolean {
  if (valueNode === undefined || actualBinding === undefined) return false;
  for (const pae of valueNode.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getExpression().getText() !== actualBinding) continue;
    const foo = pae.getName();
    const entry = map.get(foo);
    if (entry !== undefined && entry.subpath !== ownSubpath) return true;
  }
  return false;
}

function buildGroupMock(
  subpath: string,
  props: OverrideProp[],
  hadSpread: boolean,
  usesImportActual: boolean
): string {
  const spec = `${PACKAGE}/${subpath}`;
  const body = props.map(p => `    ${p.text},`).join('\n');
  if (!hadSpread) {
    return `vi.mock('${spec}', () => ({\n${body}\n}));`;
  }
  if (usesImportActual) {
    return (
      `vi.mock('${spec}', async () => {\n` +
      `  const actual = await vi.importActual<typeof import('${spec}')>('${spec}');\n` +
      `  return {\n    ...actual,\n${body}\n  };\n});`
    );
  }
  return (
    `vi.mock('${spec}', async importOriginal => {\n` +
    `  const actual = await importOriginal<typeof import('${spec}')>();\n` +
    `  return {\n    ...actual,\n${body}\n  };\n});`
  );
}

export function rewriteViMocks(sf: SourceFile, map: SymbolMap, report: MockReport): void {
  const calls = findBarrelMockCalls(sf);
  // Bottom-to-top so statement indices stay valid across remove+insert.
  calls.reverse();
  for (const call of calls) {
    const factory = call.getArguments()[1];
    if (factory === undefined) {
      report.flagged.push(`${sf.getFilePath()} :: vi.mock with no factory (auto-mock)`);
      continue;
    }
    const shape = analyzeFactory(factory);
    if (shape === undefined) {
      report.flagged.push(`${sf.getFilePath()} :: unrecognized mock factory shape`);
      continue;
    }

    const groups = new Map<string, OverrideProp[]>();
    let flagFile = false;
    for (const prop of shape.returnObj.getProperties()) {
      if (prop.getKind() === SyntaxKind.SpreadAssignment) continue; // handled via hadSpread
      const key =
        prop.asKind(SyntaxKind.PropertyAssignment)?.getName() ??
        prop.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getName() ??
        prop.asKind(SyntaxKind.MethodDeclaration)?.getName();
      if (key === undefined) {
        report.flagged.push(`${sf.getFilePath()} :: exotic mock property`);
        flagFile = true;
        break;
      }
      const valueNode = prop.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
      if (isIdentityPassthrough(valueNode, key, shape.actualBinding)) continue; // drop
      const entry = map.get(key);
      if (entry === undefined) {
        report.unresolved.push(`${sf.getFilePath()} :: mock override ${key}`);
        flagFile = true;
        break;
      }
      if (hasCrossSubpathActualRef(valueNode, shape.actualBinding, entry.subpath, map)) {
        report.flagged.push(
          `${sf.getFilePath()} :: override ${key} reaches actual.* across subpaths`
        );
        flagFile = true;
        break;
      }
      const arr = groups.get(entry.subpath) ?? [];
      arr.push({ text: prop.getText(), subpath: entry.subpath });
      groups.set(entry.subpath, arr);
    }
    if (flagFile) continue; // leave the original mock in place, flagged
    if (groups.size === 0) {
      // Every property was an identity passthrough — the mock is a no-op now.
      report.flagged.push(`${sf.getFilePath()} :: mock had only passthroughs (drop manually)`);
      continue;
    }

    const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    if (statement === undefined) {
      report.flagged.push(`${sf.getFilePath()} :: vi.mock not a top-level statement`);
      continue;
    }
    const newMocks = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subpath, props]) =>
        buildGroupMock(subpath, props, shape.hadSpread, shape.usesImportActual)
      );

    const idx = statement.getChildIndex();
    statement.remove();
    sf.insertStatements(idx, newMocks);
    report.mocksRewritten += 1;
    report.mockGroupsEmitted += groups.size;
  }
}
