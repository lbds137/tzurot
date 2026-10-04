import { describe, expect, it, vi } from 'vitest';
import { Node, Project, SyntaxKind, type Identifier, type SourceFile } from 'ts-morph';

import {
  assignedKeys,
  initializedVariableKeys,
  literalKeys,
  UNKNOWN_PAYLOAD_KEY,
} from './payloadKeys.js';

// ts-morph program creation has a cold-start cost (see analyzer.test.ts).
vi.setConfig({ testTimeout: 30_000 });

function parse(code: string): { project: Project; file: SourceFile } {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('/x.ts', code);
  return { project, file };
}

/** The identifier argument of the `send(...)` call — the analysis point. */
function sendArgument(file: SourceFile): Identifier {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(candidate => candidate.getExpression().getText() === 'send');
  const argument = call?.getArguments()[0];
  if (argument === undefined || !Node.isIdentifier(argument)) {
    throw new Error('fixture needs send(<identifier>)');
  }
  return argument;
}

function keysAtSend(code: string): string[] | undefined {
  const { project, file } = parse(code);
  return initializedVariableKeys(sendArgument(file), project.getTypeChecker());
}

describe('literalKeys', () => {
  it('returns property and shorthand keys, not spreads or methods', () => {
    const { file } = parse('const content = 1; const o = { content, a: 1, ...rest, m() {} };');
    const literal = file.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    expect(literalKeys(literal)).toEqual(['content', 'a']);
  });
});

describe('initializedVariableKeys', () => {
  it('returns the initializer keys plus assignments that precede the call', () => {
    const keys = keysAtSend(`
      declare function send(o: unknown): void;
      const o: { a?: number; b?: number; c?: number } = { a: 1 };
      o.b = 2;
      o.b = 3;
      send(o);
    `);
    expect([...(keys ?? [])].sort()).toEqual(['a', 'b']);
  });

  it('ignores an assignment that follows the call', () => {
    const keys = keysAtSend(`
      declare function send(o: unknown): void;
      const o: { a?: number; late?: number } = { a: 1 };
      send(o);
      o.late = 2;
    `);
    expect(keys).toEqual(['a']);
  });

  it('adds the keys of a whole reassignment to an object literal', () => {
    const keys = keysAtSend(`
      declare function send(o: unknown): void;
      let o: { a?: number; b?: number } = { a: 1 };
      o = { a: 1, b: 2 };
      send(o);
    `);
    expect([...(keys ?? [])].sort()).toEqual(['a', 'b']);
  });

  it('adds the marker for a non-literal reassignment, beside the known keys', () => {
    const keys = keysAtSend(`
      declare function send(o: unknown): void;
      declare function other(): { z?: number };
      let o: { a?: number; z?: number } = { a: 1 };
      o = other();
      send(o);
    `);
    expect([...(keys ?? [])].sort()).toEqual(['*', 'a']);
    expect(keys).toContain(UNKNOWN_PAYLOAD_KEY);
  });

  it('is undefined for a variable without an object-literal initializer', () => {
    expect(
      keysAtSend(`
        declare function send(o: unknown): void;
        declare const o: { a?: number };
        send(o);
      `)
    ).toBeUndefined();
  });

  it('counts a nested write as its top-level key and ignores another variable', () => {
    const keys = keysAtSend(`
      declare function send(o: unknown): void;
      const o: { a?: number; nested?: { deep?: number } } = { a: 1 };
      const other: { b?: number } = {};
      o.nested!.deep = 1;
      other.b = 2;
      send(o);
    `);
    expect([...(keys ?? [])].sort()).toEqual(['a', 'nested']);
  });
});

describe('assignedKeys', () => {
  function firstAssignment(code: string): {
    keys: (symbolOf: string) => string[];
  } {
    const { project, file } = parse(code);
    const typeChecker = project.getTypeChecker();
    const assignment = file
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .find(candidate => candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
    if (assignment === undefined) throw new Error('fixture needs an assignment');
    return {
      keys: name => {
        const declaration = file.getVariableDeclarationOrThrow(name);
        const symbol = declaration.getSymbolOrThrow();
        return assignedKeys(assignment, symbol, typeChecker);
      },
    };
  }

  it('returns the member name for a direct write to the tracked variable', () => {
    const { keys } = firstAssignment('const o: { k?: number } = {}; o.k = 1;');
    expect(keys('o')).toEqual(['k']);
  });

  it('returns the top-level key for a nested write', () => {
    const { keys } = firstAssignment('const o: { k?: { d?: number } } = {}; o.k!.d = 1;');
    expect(keys('o')).toEqual(['k']);
  });

  it('returns nothing for a write rooted at a different variable', () => {
    const { keys } = firstAssignment(
      'const o: { k?: number } = {}; const p: { k?: number } = {}; p.k = 1;'
    );
    expect(keys('o')).toEqual([]);
  });

  it('returns the literal key for an element-access write with a string key', () => {
    const quoted = firstAssignment("const o: { k?: number } = {}; o['k'] = 1;");
    expect(quoted.keys('o')).toEqual(['k']);
    const template = firstAssignment('const o: { k?: number } = {}; o[`k`] = 1;');
    expect(template.keys('o')).toEqual(['k']);
  });

  it('returns the marker for an element-access write with a computed key', () => {
    const { keys } = firstAssignment(
      "declare const name: 'k'; const o: { k?: number } = {}; o[name] = 1;"
    );
    expect(keys('o')).toEqual([UNKNOWN_PAYLOAD_KEY]);
  });

  it('returns the top-level key for nested writes mixing member and element access', () => {
    const elementThenMember = firstAssignment(
      "const o: { a?: { b?: number } } = {}; o['a']!.b = 1;"
    );
    expect(elementThenMember.keys('o')).toEqual(['a']);
    const memberThenElement = firstAssignment(
      "const o: { a?: { b?: number } } = {}; o.a!['b'] = 1;"
    );
    expect(memberThenElement.keys('o')).toEqual(['a']);
    const computedTop = firstAssignment(
      "declare const name: 'a'; const o: { a?: { b?: number } } = {}; o[name]!.b = 1;"
    );
    expect(computedTop.keys('o')).toEqual([UNKNOWN_PAYLOAD_KEY]);
  });

  it('returns nothing for an element-access write rooted at a different variable', () => {
    const { keys } = firstAssignment(
      "const o: { k?: number } = {}; const p: { k?: number } = {}; p['k'] = 1;"
    );
    expect(keys('o')).toEqual([]);
  });

  it('returns the literal keys for a whole reassignment and the marker otherwise', () => {
    const literal = firstAssignment('let o: { a?: number } = {}; o = { a: 1 };');
    expect(literal.keys('o')).toEqual(['a']);
    const opaque = firstAssignment('declare const f: () => { a?: number }; let o = {}; o = f();');
    expect(opaque.keys('o')).toEqual([UNKNOWN_PAYLOAD_KEY]);
  });
});
