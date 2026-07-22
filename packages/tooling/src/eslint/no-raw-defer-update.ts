/**
 * ESLint Rule: no-raw-defer-update
 *
 * Bans raw `interaction.deferUpdate()`. Component/modal handlers must ack via the
 * `ackUpdate` wrapper (`services/bot-client/src/ux/render/reply.ts`), which stamps
 * the defer kind so `replySpec` / `replyContent` deliver an ephemeral `followUp`
 * instead of an `editReply` that would CLOBBER the component message the
 * `deferUpdate` left in place.
 *
 * `deferUpdate` and `deferReply` both leave `deferred = true` / `replied = false`,
 * and discord.js exposes no flag distinguishing them — so the ack-state matrix
 * can only pick the right delivery method if the ack site recorded which defer it
 * performed. A RAW `deferUpdate` leaves no stamp, so a later catalog reply
 * silently takes the clobbering `editReply` branch. Routing every deferUpdate
 * through `ackUpdate` keeps the stamp reliably present.
 *
 * The one legitimate raw call lives INSIDE `ackUpdate` itself; `eslint.config.js`
 * disables this rule for `reply.ts`.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw interaction.deferUpdate(); use the ackUpdate wrapper so the defer kind is stamped and catalog replies deliver correctly',
      recommended: true,
    },
    messages: {
      rawDeferUpdate:
        'Do not call interaction.deferUpdate() directly — use ackUpdate(interaction) from ux/render/reply.js. It stamps the defer kind so a later replySpec/replyContent delivers an ephemeral followUp instead of clobbering the component message with editReply.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = (node as Node & { callee: Node }).callee;
        if (callee.type !== 'MemberExpression') {
          return;
        }
        const member = callee as Node & {
          property: Node & { type: string; name?: string };
          computed: boolean;
        };
        // `x['deferUpdate']()` (computed) is not the shape we guard; only the
        // plain `x.deferUpdate()` member call.
        if (member.computed || member.property.type !== 'Identifier') {
          return;
        }
        if (member.property.name === 'deferUpdate') {
          context.report({ node, messageId: 'rawDeferUpdate' });
        }
      },
    };
  },
};

export default rule;
