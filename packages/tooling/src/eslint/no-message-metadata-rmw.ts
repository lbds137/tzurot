/**
 * ESLint Rule: no-message-metadata-rmw
 *
 * Bans `messageMetadata` in the payload of a `conversationHistory.update`,
 * `updateMany`, `updateManyAndReturn`, or the `update` branch of an `upsert`.
 * That column is shared by independent writers (forwarded-origin backfill,
 * built references), each owning a different key of one JSON blob. A Prisma
 * update replaces the whole value, so a writer that read the blob earlier
 * writes back a copy without the other writer's key — the key vanishes with
 * no error and no log. `mergeMessageMetadata`
 * (packages/conversation-history/src/messageMetadataMerge.ts) merges
 * server-side in one `UPDATE ... || ...` statement and is the only sanctioned
 * writer of an existing row.
 *
 * Why a lint rule: `ConversationHistoryClient` is
 * `Pick<PrismaClient, 'conversationHistory'>`, so the full `update()` is in
 * reach and a read-modify-write compiles, passes the type checker and passes
 * both test tiers. Nothing but this rule distinguishes it from a legitimate
 * update of `content`.
 *
 * Never flagged: `create()` / `createMany()` / `createManyAndReturn()` and the
 * `create` branch of an upsert. Row creation sets the first value, so there is
 * no earlier read to go stale.
 *
 * Scope: purely syntactic. The receiver is matched by name (an identifier or
 * member chain ending in `conversationHistory`), and the payload is read
 * only when it is an object literal written in the call. Accepted gaps — the
 * rule cannot follow data flow or resolve bindings without type information:
 * - a payload built elsewhere and passed by variable;
 * - a spread (`{ ...patch }`) carrying the key;
 * - a nested relation write
 *   (`persona.update({ data: { conversationHistory: { update: ... } } })`);
 * - an aliased receiver (`const h = prisma.conversationHistory; h.update(...)`);
 * - a dynamic computed key (`{ [k]: m }`); a literal computed key
 *   (`{ ['messageMetadata']: m }`) is still flagged;
 * - raw SQL (`$executeRaw` / `$executeRawUnsafe`) setting `message_metadata`
 *   outside the merge module.
 * So the merge module's "every UPDATE of this column must come through here"
 * is enforced by this rule only for Prisma-client payloads written literally
 * in the call.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

const GUARDED_COLUMN = 'messageMetadata';
const RECEIVER_NAME = 'conversationHistory';
/** Methods whose payload key is `data`. */
const DATA_METHODS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

type AnyNode = Node & Record<string, unknown>;

/** TypeScript-only wrappers that leave the runtime value untouched. */
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression']);

/** Strip `as` / `satisfies` / `!` wrappers around a payload or receiver. */
function unwrap(node: AnyNode | undefined): AnyNode | undefined {
  let current = node;
  while (current !== undefined && TS_WRAPPERS.has(current.type)) {
    current = current.expression as AnyNode | undefined;
  }
  return current;
}

/** The statically readable name of a property key, or undefined. */
function keyName(property: AnyNode): string | undefined {
  const key = property.key as AnyNode | undefined;
  if (key === undefined) {
    return undefined;
  }
  if (key.type === 'Identifier' && property.computed !== true) {
    return key.name;
  }
  if (key.type === 'Literal' && typeof key.value === 'string') {
    return key.value;
  }
  return undefined;
}

function findProperty(object: AnyNode, name: string): AnyNode | undefined {
  const properties = object.properties as AnyNode[];
  return properties.find(p => p.type === 'Property' && keyName(p) === name);
}

/** Name of the method when the callee is `<...>.conversationHistory.<method>`. */
function guardedMethod(callee: AnyNode): string | undefined {
  if (callee.type !== 'MemberExpression' || callee.computed === true) {
    return undefined;
  }
  const method = callee.property as AnyNode;
  if (method.type !== 'Identifier') {
    return undefined;
  }
  const receiver = unwrap(callee.object as AnyNode);
  if (receiver === undefined) {
    return undefined;
  }
  const receiverName =
    receiver.type === 'Identifier'
      ? receiver.name
      : receiver.type === 'MemberExpression' && receiver.computed !== true
        ? ((receiver.property as AnyNode).name as string | undefined)
        : undefined;
  return receiverName === RECEIVER_NAME ? method.name : undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow messageMetadata in conversationHistory update payloads; use mergeMessageMetadata',
      recommended: true,
    },
    messages: {
      messageMetadataRmw:
        'Do not write `messageMetadata` through conversationHistory.{{method}}() — a Prisma update replaces the whole JSON blob, so a writer holding an earlier read silently erases keys another writer set in between (forwardedFrom vs referencedMessages). Use mergeMessageMetadata (packages/conversation-history/src/messageMetadataMerge.ts), which merges server-side in one statement. Setting it in create() or an upsert create branch is fine.',
    },
    schema: [],
  },

  create(context) {
    function reportIfGuarded(payload: AnyNode | undefined, method: string): void {
      const object = unwrap(payload);
      if (object?.type !== 'ObjectExpression') {
        return;
      }
      const offending = findProperty(object, GUARDED_COLUMN);
      if (offending === undefined) {
        return;
      }
      context.report({ node: offending, messageId: 'messageMetadataRmw', data: { method } });
    }

    return {
      CallExpression(node) {
        const call = node as unknown as AnyNode;
        const method = guardedMethod(call.callee as AnyNode);
        if (method === undefined) {
          return;
        }
        const args = unwrap((call.arguments as AnyNode[])[0]);
        if (args?.type !== 'ObjectExpression') {
          return;
        }
        if (DATA_METHODS.has(method)) {
          reportIfGuarded(findProperty(args, 'data')?.value as AnyNode | undefined, method);
        } else if (method === 'upsert') {
          reportIfGuarded(findProperty(args, 'update')?.value as AnyNode | undefined, method);
        }
      },
    };
  },
};

export default rule;
