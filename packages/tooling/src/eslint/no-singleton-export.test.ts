import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './no-singleton-export.js';

// Use Linter with flat config style for testing
const linter = new Linter({ configType: 'flat' });

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: {
        test: {
          rules: {
            'no-singleton-export': rule,
          },
        },
      },
      rules: {
        'test/no-singleton-export': 'error',
      },
    },
  ]);
}

describe('rule metadata', () => {
  it('should have correct metadata', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.docs?.description).toBe(
      'Disallow exporting singleton instances created at module level'
    );
    expect(rule.meta?.docs?.recommended).toBe(true);
  });

  it('should define all message IDs', () => {
    const messages = rule.meta?.messages;
    expect(messages).toBeDefined();
    expect(messages?.singletonExport).toBeDefined();
    expect(messages?.directSingletonExport).toBeDefined();
    expect(messages?.objectWithSingleton).toBeDefined();
    expect(messages?.arrayWithSingleton).toBeDefined();
    expect(messages?.importTimeExecution).toBeDefined();
  });
});

// Direct linter tests for code coverage
describe('linter integration (coverage)', () => {
  describe('valid patterns', () => {
    it('allows class exports', () => {
      const messages = lint('export class Manager {}');
      expect(messages).toHaveLength(0);
    });

    it('allows factory function exports', () => {
      const messages = lint('export function create() { return new Manager(); }');
      expect(messages).toHaveLength(0);
    });

    it('allows new inside arrow functions', () => {
      const messages = lint('export const create = () => new Manager();');
      expect(messages).toHaveLength(0);
    });

    it('allows primitive exports', () => {
      const messages = lint('export const URL = "https://example.com";');
      expect(messages).toHaveLength(0);
    });

    it('allows object without new', () => {
      const messages = lint('export default { name: "test" };');
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid patterns', () => {
    it('reports export default new Class()', () => {
      const messages = lint('export default new Manager();');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('directSingletonExport');
    });

    it('reports export const x = new Class()', () => {
      const messages = lint('export const mgr = new Manager();');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('directSingletonExport');
    });

    it('reports export default instance', () => {
      const messages = lint(`
        const mgr = new Manager();
        export default mgr;
      `);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('singletonExport');
    });

    it('reports export { instance }', () => {
      const messages = lint(`
        const mgr = new Manager();
        export { mgr };
      `);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('singletonExport');
    });

    it('reports export default { key: new Class() }', () => {
      const messages = lint('export default { mgr: new Manager() };');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('objectWithSingleton');
    });

    it('reports export const x = { key: new Class() }', () => {
      const messages = lint('export const services = { mgr: new Manager() };');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('objectWithSingleton');
    });

    it('reports export default [new Class()]', () => {
      const messages = lint('export default [new Manager()];');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('arrayWithSingleton');
    });

    it('reports export const x = [new Class()]', () => {
      const messages = lint('export const items = [new Foo(), new Bar()];');
      expect(messages.length).toBe(2);
    });

    it('reports module-level setInterval', () => {
      const messages = lint('setInterval(() => {}, 1000);');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('importTimeExecution');
    });

    it('reports module-level setTimeout', () => {
      const messages = lint('setTimeout(() => {}, 0);');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.messageId).toBe('importTimeExecution');
    });
  });

  describe('function depth tracking', () => {
    it('allows new inside nested functions', () => {
      const messages = lint(`
        function outer() {
          function inner() {
            const x = new Manager();
            return x;
          }
          return inner();
        }
        export { outer };
      `);
      expect(messages).toHaveLength(0);
    });

    it('allows setInterval inside functions', () => {
      const messages = lint(`
        function start() {
          setInterval(() => {}, 1000);
        }
        export { start };
      `);
      expect(messages).toHaveLength(0);
    });
  });
});
