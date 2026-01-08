/**
 * ESLint Rule: no-singleton-export
 *
 * Detects singleton anti-patterns where modules export instantiated objects.
 * This makes code harder to test because the instance is created at import time.
 *
 * BAD:
 *   const manager = new PersonalityManager();
 *   export default manager;
 *
 * GOOD:
 *   export class PersonalityManager { ... }
 *   // OR
 *   export function createPersonalityManager() { return new PersonalityManager(); }
 */

import type { Rule } from 'eslint';

interface TrackedInstance {
  name: string;
  className: string;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow exporting singleton instances created at module level',
      recommended: true,
    },
    messages: {
      singletonExport:
        'Avoid exporting singleton instances. Export the class or a factory function instead.',
      directSingletonExport:
        'Avoid exporting `new {{ className }}()` directly. Export the class or a factory function instead.',
      importTimeExecution:
        'Avoid calling {{ functionName }}() at module level. Move to an initialization function.',
    },
    schema: [],
  },

  create(context) {
    // Track instances created at module level (top-level variable declarations)
    const moduleInstances: TrackedInstance[] = [];

    // Track function depth to detect module-level code
    let functionDepth = 0;

    return {
      // Track entering/exiting functions to know if we're at module level
      FunctionDeclaration() {
        functionDepth++;
      },
      'FunctionDeclaration:exit'() {
        functionDepth--;
      },
      FunctionExpression() {
        functionDepth++;
      },
      'FunctionExpression:exit'() {
        functionDepth--;
      },
      ArrowFunctionExpression() {
        functionDepth++;
      },
      'ArrowFunctionExpression:exit'() {
        functionDepth--;
      },

      // Track: const instance = new Class() at module level
      VariableDeclarator(node) {
        if (functionDepth > 0) return; // Inside a function, ignore

        if (
          node.init?.type === 'NewExpression' &&
          node.id.type === 'Identifier' &&
          node.init.callee.type === 'Identifier'
        ) {
          moduleInstances.push({
            name: node.id.name,
            className: node.init.callee.name,
          });
        }
      },

      // Check: export default new Class()
      ExportDefaultDeclaration(node) {
        const declaration = node.declaration;

        // Direct: export default new Class()
        if (declaration.type === 'NewExpression' && declaration.callee.type === 'Identifier') {
          context.report({
            node,
            messageId: 'directSingletonExport',
            data: { className: declaration.callee.name },
          });
          return;
        }

        // Indirect: export default instance (where instance was created with new)
        if (declaration.type === 'Identifier') {
          const exported = moduleInstances.find(i => i.name === declaration.name);
          if (exported) {
            context.report({
              node,
              messageId: 'singletonExport',
            });
          }
        }
      },

      // Check: export { instance }
      ExportNamedDeclaration(node) {
        if (node.specifiers) {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ExportSpecifier') {
              const local = specifier.local;
              if (local.type === 'Identifier') {
                const exported = moduleInstances.find(i => i.name === local.name);
                if (exported) {
                  context.report({
                    node: specifier,
                    messageId: 'singletonExport',
                  });
                }
              }
            }
          }
        }
      },

      // Check: module-level setInterval/setTimeout
      CallExpression(node) {
        if (functionDepth > 0) return; // Inside a function, ignore

        if (
          node.callee.type === 'Identifier' &&
          ['setInterval', 'setTimeout'].includes(node.callee.name)
        ) {
          context.report({
            node,
            messageId: 'importTimeExecution',
            data: { functionName: node.callee.name },
          });
        }
      },
    };
  },
};

export default rule;
