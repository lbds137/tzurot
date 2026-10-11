import { describe, expect, it } from 'vitest';
import { Node, Project } from 'ts-morph';

import { returnedLiteralKeys, unwrapTransparent } from './literalSpreads.js';
import { UNKNOWN_PAYLOAD_KEY } from './payloadKeys.js';

function firstLiteralKeys(source: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('/a.ts', source);
  const literal = file.getFirstDescendant(Node.isObjectLiteralExpression);
  if (literal === undefined) throw new Error('fixture has no object literal');
  return returnedLiteralKeys(literal, project.getTypeChecker()).sort();
}

describe('returnedLiteralKeys', () => {
  it('reads a conditional-and spread without a marker', () => {
    expect(
      firstLiteralKeys('declare const f: boolean; export const x = { a: 1, ...(f && { b: 2 }) };')
    ).toEqual(['a', 'b']);
  });

  it('reads a ternary spread of literal and null branches', () => {
    expect(
      firstLiteralKeys(
        'declare const f: boolean; export const x = { a: 1, ...(f ? { b: 2 } : null) };'
      )
    ).toEqual(['a', 'b']);
  });

  it('adds the marker for an unreadable spread operand', () => {
    expect(
      firstLiteralKeys(
        'declare const f: boolean; declare const o: object; export const x = { a: 1, ...(f || o) };'
      )
    ).toEqual(['a', UNKNOWN_PAYLOAD_KEY].sort());
  });
});

describe('unwrapTransparent', () => {
  it('strips parentheses, casts and non-null assertions', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      '/a.ts',
      'declare const v: unknown; export const x = ((v as object)!);'
    );
    const declaration = file.getVariableDeclarationOrThrow('x');
    const initializer = declaration.getInitializerOrThrow();
    const unwrapped = unwrapTransparent(initializer);
    expect(Node.isIdentifier(unwrapped) && unwrapped.getText()).toBe('v');
  });
});
