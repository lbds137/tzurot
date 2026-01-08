import { describe, it, expect } from 'vitest';
import { RuleTester, Linter } from 'eslint';
import rule from './no-singleton-export.js';

// Configure RuleTester for ES modules
const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

// Use Linter with flat config style for code coverage
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

describe('no-singleton-export rule', () => {
  describe('valid cases', () => {
    it('should allow exporting classes', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: ['export class PersonalityManager {}'],
        invalid: [],
      });
    });

    it('should allow exporting factory functions', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: ['export function createManager() { return new Manager(); }'],
        invalid: [],
      });
    });

    it('should allow new expressions inside functions', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [
          `
          function init() {
            const mgr = new Manager();
            return mgr;
          }
          export { init };
          `,
        ],
        invalid: [],
      });
    });

    it('should allow exporting primitives and objects without new', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [
          'export const config = { timeout: 5000 };',
          'export const API_URL = "https://api.example.com";',
          'export default { name: "test" };',
        ],
        invalid: [],
      });
    });
  });

  describe('invalid cases - direct exports', () => {
    it('should report export default new Class()', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'export default new PersonalityManager();',
            errors: [{ messageId: 'directSingletonExport' }],
          },
        ],
      });
    });

    it('should report export const x = new Class()', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'export const manager = new Manager();',
            errors: [{ messageId: 'directSingletonExport' }],
          },
        ],
      });
    });
  });

  describe('invalid cases - indirect exports', () => {
    it('should report export default instance', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: `
              const manager = new PersonalityManager();
              export default manager;
            `,
            errors: [{ messageId: 'singletonExport' }],
          },
        ],
      });
    });

    it('should report export { instance }', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: `
              const manager = new PersonalityManager();
              export { manager };
            `,
            errors: [{ messageId: 'singletonExport' }],
          },
        ],
      });
    });
  });

  describe('invalid cases - object exports', () => {
    it('should report export default { mgr: new Class() }', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'export default { mgr: new Manager() };',
            errors: [{ messageId: 'objectWithSingleton' }],
          },
        ],
      });
    });

    it('should report export const x = { mgr: new Class() }', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'export const services = { mgr: new Manager() };',
            errors: [{ messageId: 'objectWithSingleton' }],
          },
        ],
      });
    });
  });

  describe('invalid cases - array exports', () => {
    it('should report export default [new Class()]', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'export default [new Manager()];',
            errors: [{ messageId: 'arrayWithSingleton' }],
          },
        ],
      });
    });

    it('should report export const x = [new Class()]', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'export const managers = [new Manager(), new Handler()];',
            errors: [{ messageId: 'arrayWithSingleton' }, { messageId: 'arrayWithSingleton' }],
          },
        ],
      });
    });
  });

  describe('invalid cases - import-time execution', () => {
    it('should report module-level setInterval', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'setInterval(() => {}, 1000);',
            errors: [{ messageId: 'importTimeExecution' }],
          },
        ],
      });
    });

    it('should report module-level setTimeout', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [],
        invalid: [
          {
            code: 'setTimeout(() => {}, 0);',
            errors: [{ messageId: 'importTimeExecution' }],
          },
        ],
      });
    });

    it('should allow setInterval inside functions', () => {
      ruleTester.run('no-singleton-export', rule, {
        valid: [
          `
          function startPolling() {
            setInterval(() => {}, 1000);
          }
          export { startPolling };
          `,
        ],
        invalid: [],
      });
    });
  });
});

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
