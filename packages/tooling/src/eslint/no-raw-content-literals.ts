/**
 * ESLint Rule: no-raw-content-literals
 *
 * The catalog-adoption guard (platform-portable-ux-design §4.5, stage two):
 * user-facing message COPY in command files must come from the ux/catalog
 * message layer (`renderSpec(CATALOG…)`), not hand-written string literals.
 * This is the AST successor to the retired `ux:literals` grep ratchet — it
 * measures the actual shape (a literal reaching a Discord messaging call's
 * content) instead of marker glyphs, so it can't be dodged by omitting ❌
 * and can't false-positive on comments.
 *
 * What is flagged (in `services/bot-client/src/commands/`, non-test files):
 *   - A string/template literal passed directly to a messaging method
 *     (`reply`, `editReply`, `followUp`, `update`, `send`) — either as the
 *     whole first argument or as the `content` property of an options object.
 *   - The same, one hop away: a same-file `const` whose init is a raw literal
 *     and which is referenced at a content position (deduped across call
 *     sites — reported at the declaration, where the copy lives; an init that
 *     concatenates several literal fragments counts each fragment, since each
 *     is its own piece of copy).
 *   - Literals inside conditional/logical/`+`-concatenation expressions at
 *     those positions (each literal branch is a violation).
 *
 * What is NOT flagged:
 *   - Call results (`renderSpec(...)`, `classifyGatewayFailure(...)` chains) —
 *     the catalog path.
 *   - Imported constants — centralized copy is a different problem class than
 *     per-file raw literals, and cross-module tracing is out of AST reach.
 *   - Embed composition (titles, descriptions, fields) — governed by the
 *     shared builders and `no-discord-builders-in-commands`, not the catalog.
 *
 * Grandfathering: `raw-content-allowlist.ts` maps file → violation budget
 * (shrink-only). A file at or under its budget reports nothing; one over
 * budget reports EVERY violation so the author sees the full candidate set.
 */

import type { Rule, Scope } from 'eslint';
import { RAW_CONTENT_ALLOWLIST } from './raw-content-allowlist.js';

/** Methods whose string payload renders as a Discord message. */
const MESSAGING_METHODS = new Set(['reply', 'editReply', 'followUp', 'update', 'send']);

const COMMANDS_MARKER = 'services/bot-client/src/commands/';

/**
 * The repo-relative path of the linted file (forward slashes), or null when
 * the file is not under the commands tree. Suffix-matching from the marker
 * keeps the rule cwd-independent (lint-staged invokes eslint from varying
 * working directories).
 */
function commandsRelativePath(filename: string): string | null {
  const normalized = filename.replace(/\\/g, '/');
  const at = normalized.indexOf(COMMANDS_MARKER);
  return at === -1 ? null : normalized.slice(at);
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function isStringLiteral(node: AstNode): boolean {
  return node.type === 'Literal' && typeof (node as { value?: unknown }).value === 'string';
}

/** Resolve an identifier to a same-file variable, walking scopes upward. */
function resolveVariable(context: Rule.RuleContext, identifier: AstNode): Scope.Variable | null {
  const name = (identifier as { name?: string }).name;
  if (name === undefined) {
    return null;
  }
  let scope: Scope.Scope | null = context.sourceCode.getScope(identifier as unknown as Rule.Node);
  while (scope !== null) {
    const variable = scope.variables.find(v => v.name === name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return null;
}

/** Collect raw-literal violations from a value at a content position. */
/**
 * A template literal counts as raw COPY only when a quasi carries text — a
 * pure-interpolation template (string coercion at a content position) has no
 * hand-written copy to migrate.
 */
function templateHasCopy(node: AstNode): boolean {
  const quasis = (node as unknown as { quasis: { value: { raw: string } }[] }).quasis;
  return quasis.some(q => q.value.raw.trim() !== '');
}

function collectContentValue(
  context: Rule.RuleContext,
  violations: Set<AstNode>,
  node: AstNode
): void {
  if (isStringLiteral(node) || (node.type === 'TemplateLiteral' && templateHasCopy(node))) {
    violations.add(node);
    return;
  }
  if (node.type === 'ConditionalExpression') {
    collectContentValue(context, violations, node.consequent as AstNode);
    collectContentValue(context, violations, node.alternate as AstNode);
    return;
  }
  if (node.type === 'LogicalExpression') {
    collectContentValue(context, violations, node.left as AstNode);
    collectContentValue(context, violations, node.right as AstNode);
    return;
  }
  if (node.type === 'BinaryExpression' && (node as { operator?: string }).operator === '+') {
    collectContentValue(context, violations, node.left as AstNode);
    collectContentValue(context, violations, node.right as AstNode);
    return;
  }
  if (node.type === 'Identifier') {
    // One hop: a same-file const holding a raw literal is the same copy,
    // parked one line up. Imported bindings and parameters pass — the
    // rule's reach is per-file raw copy, not cross-module provenance.
    const def = resolveVariable(context, node)?.defs[0];
    if (def?.type !== 'Variable') {
      return;
    }
    const init = (def.node as { init?: AstNode | null }).init;
    if (init === null || init === undefined) {
      return;
    }
    collectContentValue(context, violations, init);
  }
}

/** Extract the content value from a messaging call's first argument. */
function collectFromArgument(
  context: Rule.RuleContext,
  violations: Set<AstNode>,
  arg: AstNode
): void {
  if (arg.type === 'ObjectExpression') {
    for (const prop of (arg as unknown as { properties: AstNode[] }).properties) {
      if (prop.type !== 'Property') {
        continue;
      }
      const key = (prop as unknown as { key: AstNode }).key;
      const computed = (prop as { computed?: boolean }).computed === true;
      const keyName = computed
        ? undefined
        : ((key as { name?: string }).name ?? (key as { value?: unknown }).value);
      if (keyName === 'content') {
        collectContentValue(context, violations, (prop as unknown as { value: AstNode }).value);
      }
    }
    return;
  }
  collectContentValue(context, violations, arg);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw string literals reaching Discord messaging-call content in command files — render through ux/catalog instead',
      recommended: true,
    },
    messages: {
      rawContent:
        'Raw user-facing message literal at a Discord content position — render through the ' +
        'ux/catalog layer (renderSpec(CATALOG…)) so tone, glyphs, and outcome-honesty stay ' +
        'centralized. This file has {{count}} raw literal(s) against a grandfathered budget of ' +
        '{{budget}} (raw-content-allowlist.ts, shrink-only): migrate copy to the catalog rather ' +
        'than raising the budget.',
    },
    schema: [],
  },

  create(context) {
    const relPath = commandsRelativePath(context.filename);
    if (relPath === null || relPath.endsWith('.test.ts')) {
      return {};
    }
    const budget = RAW_CONTENT_ALLOWLIST[relPath] ?? 0;

    /** Distinct flagged nodes (a const's init dedupes across its call sites). */
    const violations = new Set<AstNode>();

    return {
      CallExpression(node) {
        const callee = node.callee as unknown as AstNode;
        if (callee.type !== 'MemberExpression' || (callee as { computed?: boolean }).computed) {
          return;
        }
        const property = (callee as { property?: AstNode }).property;
        const methodName =
          property?.type === 'Identifier' ? (property as { name?: string }).name : undefined;
        if (methodName === undefined || !MESSAGING_METHODS.has(methodName)) {
          return;
        }
        const firstArg = (node.arguments as unknown as AstNode[])[0];
        if (firstArg !== undefined) {
          collectFromArgument(context, violations, firstArg);
        }
      },

      'Program:exit'() {
        if (violations.size <= budget) {
          return;
        }
        for (const violation of violations) {
          context.report({
            node: violation as unknown as Rule.Node,
            messageId: 'rawContent',
            data: { count: String(violations.size), budget: String(budget) },
          });
        }
      },
    };
  },
};

export default rule;
