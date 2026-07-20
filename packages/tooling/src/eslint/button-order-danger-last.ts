/**
 * ESLint Rule: button-order-danger-last
 *
 * Enforces the design-system button-order standard (spec §3 / 04-discord.md
 * "Standard Button Order"): within one action row, a Danger-styled button is
 * always LAST — destructive actions never sit to the left of safe ones.
 * Hand-rolled rows drift into Danger-first ordering when built ad hoc; the
 * confirmation factories own the order for factory-built rows, and this rule
 * keeps the class dead for hand-built ones.
 *
 * What is flagged: inside a single `addComponents(...)` / `setComponents(...)`
 * argument list (or a single array literal argument), an INLINE
 * `new ButtonBuilder()…` chain whose `.setStyle(ButtonStyle.Danger)` precedes
 * a sibling inline chain with a statically-visible non-Danger style.
 *
 * Known limitation (deliberate): buttons built into variables and passed by
 * name (`addComponents(confirm, cancel)`) are invisible to this rule — style
 * resolution would need cross-statement data flow. The sanctioned factories
 * (confirmAction/confirmDestructive/buildBrowseButtons) own those shapes and
 * are order-correct by construction; the rule guards the inline hand-rolled
 * shape, which is where the historical violations lived.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

const COMPONENT_METHODS = new Set(['addComponents', 'setComponents']);

interface MemberNode {
  type: string;
  object?: MemberNode & { name?: string };
  property?: { type: string; name?: string };
  callee?: MemberNode;
  arguments?: Node[];
}

/** The ButtonStyle member name from a `.setStyle(ButtonStyle.X)` argument, or null. */
function styleArgumentName(arg: MemberNode | undefined): string | null {
  const isStyleMember =
    arg?.type === 'MemberExpression' &&
    arg.object?.type === 'Identifier' &&
    arg.object.name === 'ButtonStyle' &&
    arg.property?.type === 'Identifier';
  return isStyleMember ? (arg.property?.name ?? null) : null;
}

/**
 * The statically-visible ButtonStyle of an inline `new ButtonBuilder()…` chain,
 * or null when the expression is not such a chain / carries no visible style.
 * Walks the fluent chain: CallExpression(MemberExpression(...)) down to a
 * NewExpression of ButtonBuilder, collecting `.setStyle(ButtonStyle.X)`.
 */
function inlineButtonStyle(expr: Node): string | null {
  let node = expr as unknown as MemberNode;
  let style: string | null = null;
  let sawButtonBuilderNew = false;

  while (node !== undefined && node !== null) {
    if (node.type === 'NewExpression') {
      const callee = node.callee as unknown as { name?: string } | undefined;
      sawButtonBuilderNew = callee?.name === 'ButtonBuilder';
      break;
    }
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') {
      break;
    }
    const member = node.callee;
    if (member.property?.type === 'Identifier' && member.property.name === 'setStyle') {
      // The outer→inner walk visits the LAST-executed setStyle first — and the
      // last call wins at runtime (it's a plain field set) — so the first hit
      // is authoritative; never overwrite it with an earlier-executed one.
      const found = styleArgumentName(node.arguments?.[0]);
      if (found !== null && style === null) {
        style = found;
      }
    }
    node = member.object as MemberNode;
  }

  return sawButtonBuilderNew ? style : null;
}

function checkSequence(context: Rule.RuleContext, elements: Node[]): void {
  const styles = elements.map(inlineButtonStyle);
  for (let i = 0; i < styles.length; i++) {
    if (styles[i] !== 'Danger') {
      continue;
    }
    const laterNonDanger = styles.some((style, j) => j > i && style !== null && style !== 'Danger');
    if (laterNonDanger) {
      context.report({
        node: elements[i] as unknown as Rule.Node,
        messageId: 'dangerBeforeSafe',
      });
    }
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Danger-styled buttons come last in an action row — a destructive button must not precede a non-Danger sibling',
      recommended: true,
    },
    messages: {
      dangerBeforeSafe:
        'Danger-styled button precedes a non-Danger sibling in the same row — destructive actions are always LAST (04-discord.md "Standard Button Order"). Reorder the arguments, or use the confirmation factories which own the order.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const call = node as unknown as MemberNode;
        if (
          call.callee?.type !== 'MemberExpression' ||
          call.callee.property?.type !== 'Identifier' ||
          call.callee.property.name === undefined ||
          !COMPONENT_METHODS.has(call.callee.property.name)
        ) {
          return;
        }
        const args = call.arguments ?? [];
        // Both call shapes are legal discord.js: addComponents(a, b, c) and
        // addComponents([a, b, c]) — normalize to one element sequence.
        const first = args[0] as unknown as { type?: string; elements?: Node[] } | undefined;
        if (args.length === 1 && first?.type === 'ArrayExpression') {
          checkSequence(
            context,
            (first.elements ?? []).filter((e): e is Node => e !== null)
          );
        } else {
          checkSequence(context, args);
        }
      },
    };
  },
};

export default rule;
