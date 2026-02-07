import { describe, it, expect } from 'vitest';

import { parseFile } from './file-parser.js';

describe('parseFile', () => {
  describe('function extraction', () => {
    it('should extract exported functions with parameters and return types', () => {
      const code = `
export function greet(name: string, loud?: boolean): string {
  return loud ? name.toUpperCase() : name;
}
`;
      const result = parseFile('test.ts', code, { includePrivate: false });

      expect(result.declarations).toHaveLength(1);
      const decl = result.declarations[0];
      expect(decl.kind).toBe('function');
      expect(decl.name).toBe('greet');
      expect(decl.exported).toBe(true);
      expect(decl.parameters).toHaveLength(2);
      expect(decl.parameters?.[0]).toEqual({ name: 'name', type: 'string', optional: false });
      expect(decl.parameters?.[1]).toEqual({ name: 'loud', type: 'boolean', optional: true });
      expect(decl.returnType).toBe('string');
    });

    it('should skip non-exported functions by default', () => {
      const code = `
function helper() {}
export function main() {}
`;
      const result = parseFile('test.ts', code, { includePrivate: false });

      expect(result.declarations).toHaveLength(1);
      expect(result.declarations[0].name).toBe('main');
    });

    it('should include non-exported functions when includePrivate is true', () => {
      const code = `
function helper() {}
export function main() {}
`;
      const result = parseFile('test.ts', code, { includePrivate: true });

      expect(result.declarations).toHaveLength(2);
      expect(result.declarations[0].name).toBe('helper');
      expect(result.declarations[0].exported).toBe(false);
    });
  });

  describe('class extraction', () => {
    it('should extract class with methods and properties', () => {
      const code = `
export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getUser(id: string): Promise<User> {
    return this.db.find(id);
  }

  private formatUser(user: User): string {
    return user.name;
  }
}
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations).toHaveLength(1);
      const cls = result.declarations[0];
      expect(cls.kind).toBe('class');
      expect(cls.name).toBe('UserService');
      expect(cls.exported).toBe(true);
      expect(cls.members).toBeDefined();

      const methods = cls.members?.filter(m => m.kind === 'method');
      expect(methods).toHaveLength(2);
      expect(methods?.[0].name).toBe('getUser');
      expect(methods?.[0].parameters).toHaveLength(1);
      expect(methods?.[1].name).toBe('formatUser');
      expect(methods?.[1].visibility).toBe('private');

      const props = cls.members?.filter(m => m.kind === 'property');
      expect(props).toHaveLength(1);
      expect(props?.[0].name).toBe('db');
      expect(props?.[0].visibility).toBe('private');
    });
  });

  describe('interface and type extraction', () => {
    it('should extract interfaces', () => {
      const code = `
export interface Config {
  host: string;
  port: number;
}
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations).toHaveLength(1);
      expect(result.declarations[0].kind).toBe('interface');
      expect(result.declarations[0].name).toBe('Config');
      expect(result.declarations[0].exported).toBe(true);
    });

    it('should extract type aliases', () => {
      const code = `
export type UserId = string;
type InternalId = number;
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations).toHaveLength(1);
      expect(result.declarations[0].kind).toBe('type');
      expect(result.declarations[0].name).toBe('UserId');
    });
  });

  describe('const and enum extraction', () => {
    it('should extract exported consts', () => {
      const code = `
export const MAX_RETRIES = 3;
export const CONFIG = { host: 'localhost' } as const;
const secret = 'hidden';
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations).toHaveLength(2);
      expect(result.declarations[0].name).toBe('MAX_RETRIES');
      expect(result.declarations[0].kind).toBe('const');
      expect(result.declarations[1].name).toBe('CONFIG');
    });

    it('should extract enums', () => {
      const code = `
export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations).toHaveLength(1);
      expect(result.declarations[0].kind).toBe('enum');
      expect(result.declarations[0].name).toBe('Status');
    });
  });

  describe('JSDoc extraction', () => {
    it('should extract first line of JSDoc', () => {
      const code = `
/**
 * Process a user request.
 *
 * This function does complex things.
 */
export function processRequest(): void {}
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations[0].description).toBe('Process a user request.');
    });

    it('should handle missing JSDoc gracefully', () => {
      const code = `export function noDoc(): void {}`;
      const result = parseFile('test.ts', code);

      expect(result.declarations[0].description).toBeUndefined();
    });
  });

  describe('import extraction', () => {
    it('should extract named imports', () => {
      const code = `
import { readFile, writeFile } from 'node:fs';
import type { Config } from './types.js';
export const x = 1;
`;
      const result = parseFile('test.ts', code, { includeImports: true });

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0]).toEqual({
        source: 'node:fs',
        namedImports: ['readFile', 'writeFile'],
        isTypeOnly: false,
      });
      expect(result.imports[1]).toEqual({
        source: './types.js',
        namedImports: ['Config'],
        isTypeOnly: true,
      });
    });

    it('should not include imports when option is false', () => {
      const code = `
import { something } from './module.js';
export const x = 1;
`;
      const result = parseFile('test.ts', code, { includeImports: false });

      expect(result.imports).toHaveLength(0);
    });

    it('should handle default and namespace imports', () => {
      const code = `
import chalk from 'chalk';
import * as path from 'node:path';
export const x = 1;
`;
      const result = parseFile('test.ts', code, { includeImports: true });

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].namedImports).toContain('chalk');
      expect(result.imports[1].namedImports).toContain('* as path');
    });
  });

  describe('line counting', () => {
    it('should count file lines', () => {
      const code = `line1\nline2\nline3\n`;
      const result = parseFile('test.ts', code);

      expect(result.lineCount).toBe(4); // trailing newline creates empty last line
    });

    it('should track function body line count', () => {
      const code = `
export function big(): void {
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  const e = 5;
}
`;
      const result = parseFile('test.ts', code);

      expect(result.declarations[0].bodyLineCount).toBeGreaterThan(1);
    });
  });

  describe('declaration ordering', () => {
    it('should sort declarations by line number', () => {
      const code = `
export interface Config {}
export function setup(): void {}
export class App {}
export const VERSION = '1.0';
`;
      const result = parseFile('test.ts', code);

      const lines = result.declarations.map(d => d.line);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
    });
  });
});
