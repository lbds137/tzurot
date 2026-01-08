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
 *   export default new PersonalityManager();
 *
 *   export default { mgr: new PersonalityManager() };
 *
 *   export const instances = [new Foo(), new Bar()];
 *
 * GOOD:
 *   export class PersonalityManager { ... }
 *   // OR
 *   export function createPersonalityManager() { return new PersonalityManager(); }
 */

import type { Rule } from 'eslint';
import type { Node, Property } from 'estree';

interface TrackedInstance {
  name: string;
  className: string;
}

// Helper: Check if a node is a NewExpression with Identifier callee
function isNewExpressionWithIdentifier(
  node: Node | null | undefined
): node is Node & { type: 'NewExpression'; callee: { type: 'Identifier'; name: string } } {
  return (
    node?.type === 'NewExpression' &&
    'callee' in node &&
    (node.callee as Node).type === 'Identifier'
  );
}

// Helper: Report singleton in array elements
function reportArraySingletons(context: Rule.RuleContext, elements: (Node | null)[]): void {
  for (const element of elements) {
    if (isNewExpressionWithIdentifier(element)) {
      context.report({
        node: element as unknown as Rule.Node,
        messageId: 'arrayWithSingleton',
        data: { className: element.callee.name },
      });
    }
  }
}

// Helper: Report singleton in object properties
function reportObjectSingletons(context: Rule.RuleContext, properties: (Property | Node)[]): void {
  for (const prop of properties) {
    if (prop.type === 'Property' && isNewExpressionWithIdentifier((prop as Property).value)) {
      const propValue = (prop as Property).value as Node & {
        callee: { name: string };
      };
      context.report({
        node: prop as unknown as Rule.Node,
        messageId: 'objectWithSingleton',
        data: { className: propValue.callee.name },
      });
    }
  }
}

// Helper: Handle export default declarations
function handleExportDefault(
  context: Rule.RuleContext,
  node: Rule.Node,
  moduleInstances: TrackedInstance[]
): void {
  const exportNode = node as unknown as { declaration: Node };
  const declaration = exportNode.declaration;

  // Direct: export default new Class()
  if (isNewExpressionWithIdentifier(declaration)) {
    context.report({
      node,
      messageId: 'directSingletonExport',
      data: { className: declaration.callee.name },
    });
    return;
  }

  // Object: export default { mgr: new Class() }
  if (declaration.type === 'ObjectExpression') {
    reportObjectSingletons(context, declaration.properties);
    return;
  }

  // Array: export default [new Class()]
  if (declaration.type === 'ArrayExpression') {
    reportArraySingletons(context, declaration.elements);
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
}

// Helper: Handle export named declarations
function handleExportNamed(
  context: Rule.RuleContext,
  node: Rule.Node,
  moduleInstances: TrackedInstance[]
): void {
  const exportNode = node as unknown as {
    specifiers?: { type: string; local: { type: string; name: string } }[];
    declaration?: { type: string; declarations?: { init: Node | null }[] };
  };

  // Handle: export { instance }
  for (const specifier of exportNode.specifiers ?? []) {
    if (specifier.type !== 'ExportSpecifier') continue;
    if (specifier.local.type !== 'Identifier') continue;

    const exported = moduleInstances.find(i => i.name === specifier.local.name);
    if (exported) {
      context.report({
        node: specifier as unknown as Rule.Node,
        messageId: 'singletonExport',
      });
    }
  }

  // Handle: export const x = new Foo() / [new Foo()] / { mgr: new Foo() }
  if (exportNode.declaration?.type !== 'VariableDeclaration') return;

  for (const declarator of exportNode.declaration.declarations ?? []) {
    const init = declarator.init;
    if (!init) continue;

    // Direct: export const x = new Foo()
    if (isNewExpressionWithIdentifier(init)) {
      context.report({
        node: declarator as unknown as Rule.Node,
        messageId: 'directSingletonExport',
        data: { className: init.callee.name },
      });
    }

    // Array: export const x = [new Foo()]
    if (init.type === 'ArrayExpression') {
      reportArraySingletons(context, init.elements);
    }

    // Object: export const x = { mgr: new Foo() }
    if (init.type === 'ObjectExpression') {
      reportObjectSingletons(context, init.properties);
    }
  }
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
      objectWithSingleton:
        'Avoid exporting objects containing `new {{ className }}()`. Export factory functions instead.',
      arrayWithSingleton:
        'Avoid exporting arrays containing `new {{ className }}()`. Export factory functions instead.',
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
        handleExportDefault(context, node, moduleInstances);
      },

      // Check: export { instance } or export const x = [new Foo()]
      ExportNamedDeclaration(node) {
        handleExportNamed(context, node, moduleInstances);
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
