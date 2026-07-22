/**
 * ESLint Rule: component-handler-ack-first
 *
 * Enforces Discord's 3-second interaction rule structurally. The invariant, stated
 * precisely:
 *
 *   A handler must not perform a BARE acknowledgement (`interaction.deferUpdate()` /
 *   `deferReply` / `reply` / `update` / `showModal`) AFTER it has already awaited
 *   real async work (a Redis session lookup, a Prisma query, a gateway fetch).
 *
 * A bare ack that lands after slow work risks blowing the 3-second budget before
 * the ack reaches Discord — the user gets a silent "This interaction failed". The
 * `handleBrowsePagination` regression (awaited a session lookup, THEN `deferUpdate`)
 * is the canonical bug; it recurred across three review rounds, so it's enforced at
 * author-time. See `.claude/rules/04-discord.md` § "3-Second Rule".
 *
 * TWO WAYS TO SATISFY THE RULE — and why the wrapper path matters:
 *
 *   1. Ack FIRST. Put the bare ack before any awaited work:
 *        handleButton: async interaction => {
 *          await interaction.deferUpdate();          // ack first
 *          const session = await findSession(...);   // then async work
 *        }
 *
 *   2. WRAP a necessarily-late ack. Some handlers MUST inspect data before they can
 *      choose the ack — e.g. a modal whose fields are prefilled from a fetched row.
 *      Ack-first is impossible there. The accepted mitigation is a wrapper helper
 *      (`ackWithTimeoutCatch` / `showModalWithTimeoutCatch`) that catches the 10062
 *      "interaction expired" error if the budget blew and degrades to a followUp:
 *        handleEditButton: async interaction => {
 *          const memory = await fetchMemory(id);            // real work first (unavoidable)
 *          await showModalWithTimeoutCatch(interaction, …); // wrapped ack — OK
 *        }
 *
 * The rule treats any awaited call that is passed the WHOLE `interaction` as a
 * legitimate ack/handoff and does NOT flag it (it's either a wrapper that catches
 * the timeout, or a delegation to a sub-handler that acks). Only a BARE
 * `interaction.<ackMethod>()` after real async work is flagged — that's the one
 * shape that silently fails. So `fetch → bare showModal()` is flagged (use a wrapper
 * or hoist the ack); `fetch → showModalWithTimeoutCatch(interaction)` passes.
 *
 * NOT enforced: "every handler must ack." Routers sync-check then DELEGATE
 * (`await handleServersSelect(interaction)`); sub-handlers are often called post-ack
 * and rely on the caller's ack. Those legitimately own no ack. Proving "this handler
 * never acks at all" needs reachability analysis (FP-prone on branches/early
 * returns) and is intentionally out of scope — a separate rule if ever wanted.
 *
 * Scope: targets ONLY handlers that receive a RAW interaction needing an ack —
 * detected (a) by the `handleButton` / `handleSelectMenu` key (defineCommand router
 * entries, whose arrow param is often un-annotated) and (b) by a first parameter
 * typed as a Button/SelectMenu/ModalSubmit interaction (downstream handlers). Slash
 * handlers (already-deferred `context`), autocomplete handlers (respond directly),
 * and plain helpers are NOT targeted.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * Methods that perform the INITIAL acknowledgement of an interaction. Deliberately
 * excludes `followUp` / `editReply` — those are POST-ack calls (they only run once
 * the interaction is already acked), so they are never the bug this rule guards.
 */
const ACK_METHODS = new Set(['deferUpdate', 'deferReply', 'reply', 'update', 'showModal']);

/**
 * Ack WRAPPER functions that are bare-ack-equivalent: `ackUpdate(interaction)` /
 * `ackDeferReply(interaction)` (ux/render/reply.ts) are just a raw `deferUpdate`/
 * `deferReply` plus a defer-kind stamp — they carry NO timeout safety net and MUST
 * run first, exactly like the raw call they replace. They are matched here (an
 * Identifier callee passed the interaction) so a preceding `sawRealAsync` still
 * flags them. This is the crucial distinction from the `*WithTimeoutCatch`
 * wrappers below (`passesInteractionToCallee`), which are DESIGNED to be called
 * late and catch the 10062 timeout — those stay exempt; these do not.
 */
const ACK_WRAPPER_FUNCTIONS = new Set(['ackUpdate', 'ackDeferReply']);

/**
 * POST-ack response methods on the interaction. These run only AFTER an ack, so
 * an `await interaction.followUp()` / `editReply()` is a response, NOT a data
 * fetch — it must NOT count as "real async work" that would flag a following bare
 * ack. Excluding them kills the branch-leak false positive from the standard
 * ack-state-aware helper shape (`if (acked) followUp else reply`), where the
 * acked-branch response would otherwise leak `sawRealAsync` onto the sibling
 * else-branch `reply`.
 */
const RESPONSE_METHODS = new Set(['followUp', 'editReply', 'deleteReply']);

/**
 * defineCommand keys whose value is a raw-interaction router entry. Includes
 * `handleModal` (ModalSubmitInteraction) — the canonical wrapper-ack case this
 * rule's docstring cites — so a `handleModal: async interaction => {…}` arrow
 * entry gets the same coverage as its button/select siblings.
 */
const ROUTER_KEYS = new Set(['handleButton', 'handleSelectMenu', 'handleModal']);

/**
 * Param type names that REQUIRE an ack. Select-menu variants
 * (String/User/Role/Channel/Mentionable/Any) all end in `SelectMenuInteraction`.
 * Deliberately excludes `AutocompleteInteraction` (no ack — responds directly)
 * and `ChatInputCommandInteraction` (this codebase defers those upstream and
 * passes a deferred `context` to subcommand handlers).
 */
const ACK_REQUIRING_TYPE = /(?:Button|SelectMenu|ModalSubmit)Interaction$/;

interface HandlerFrame {
  /** Whether this function is a candidate interaction handler. */
  isHandler: boolean;
  /** The interaction parameter's identifier name (for matching `x.deferUpdate()`). */
  interactionName: string | null;
  /**
   * Whether the handler has already awaited real async work (a non-ack call that
   * is NOT passed the whole interaction — i.e. a data/IO op like a Redis lookup).
   * Once true, a subsequent BARE ack is the bug. Monotonic: only flips false→true.
   */
  sawRealAsync: boolean;
}

type FunctionNode = Node & {
  type: 'ArrowFunctionExpression' | 'FunctionExpression' | 'FunctionDeclaration';
  params: Node[];
  parent?: Node;
};

/** The first param's identifier name, or null if it isn't a plain identifier. */
function firstParamName(fn: FunctionNode): string | null {
  const first = fn.params[0];
  return first?.type === 'Identifier' ? (first as Node & { name: string }).name : null;
}

/** The `typeName.name` of a TSTypeReference node, or null for any other shape. */
function typeRefName(typeNode: unknown): string | null {
  const name = (typeNode as { typeName?: { name?: string } } | undefined)?.typeName?.name;
  return typeof name === 'string' ? name : null;
}

/**
 * True if the first param carries a type annotation matching an ack-requiring
 * interaction — directly (`interaction: ButtonInteraction`) or as a member of a
 * union (`interaction: ButtonInteraction | StringSelectMenuInteraction`). A
 * handler shared across ack-requiring interaction kinds still owns the ordering
 * guarantee, so the union form must be recognized — its node is a `TSUnionType`
 * (with `.types[]`, no `.typeName`), not a `TSTypeReference`.
 */
function firstParamIsAckInteraction(fn: FunctionNode): boolean {
  const first = fn.params[0] as
    (Node & { typeAnnotation?: { typeAnnotation?: unknown } }) | undefined;
  const typeNode = first?.typeAnnotation?.typeAnnotation as
    { type?: string; types?: unknown[] } | undefined;
  if (typeNode === undefined) {
    return false;
  }
  if (typeNode.type === 'TSUnionType' && Array.isArray(typeNode.types)) {
    return typeNode.types.some(member => {
      const name = typeRefName(member);
      return name !== null && ACK_REQUIRING_TYPE.test(name);
    });
  }
  const name = typeRefName(typeNode);
  return name !== null && ACK_REQUIRING_TYPE.test(name);
}

/** True if the function is the value of a `handleButton`/`handleSelectMenu` property. */
function isRouterEntry(fn: FunctionNode): boolean {
  const parent = fn.parent;
  if (parent?.type !== 'Property') {
    return false;
  }
  const key = (parent as Node & { key: Node & { name?: string }; value: Node }).key;
  const value = (parent as Node & { value: Node }).value;
  return value === fn && key.type === 'Identifier' && ROUTER_KEYS.has(key.name ?? '');
}

/**
 * True if the awaited call is passed the WHOLE `interaction` as a direct argument
 * — `await handleServersSelect(interaction)`, `await showModalWithTimeoutCatch(interaction, …)`,
 * `await ackWithTimeoutCatch(interaction, () => …)`. Such a callee CAN acknowledge
 * the interaction itself (a wrapper that catches the 3s timeout, or a delegation to
 * a sub-handler), so the await is a legitimate ack/handoff — NOT real async work,
 * and NOT a bare ack. The rule neither flags it nor counts it as preceding work.
 *
 * The discriminator is passing the interaction OBJECT vs. extracted DATA: a call
 * passed only `interaction.user.id` / `interaction.message.id` (a member) cannot
 * ack — it's a data/IO op (e.g. a Redis `getSession`), so it IS real async work and
 * a following bare ack is flagged. This is the line between a wrapper/delegation and
 * the real bug (an awaited lookup before a bare ack).
 */
function passesInteractionToCallee(
  argument: Node | null | undefined,
  interactionName: string | null
): boolean {
  if (argument?.type !== 'CallExpression' || interactionName === null) {
    return false;
  }
  const call = argument as Node & { arguments: Node[] };
  return call.arguments.some(arg => argReferencesInteraction(arg, interactionName));
}

/**
 * True if a call argument hands the whole interaction to the callee — either
 * directly (`fn(interaction)`) or as a property of an options object
 * (`fetchOrCreateSession({ entityId, interaction })`, the dashboard helper shape).
 * The options-object form is common enough that missing it false-flags every
 * handler that delegates via an options bag — `interaction.user.id` (a member,
 * not the identifier) still correctly reads as extracted DATA, not the object.
 */
function argReferencesInteraction(arg: Node, interactionName: string): boolean {
  if (arg.type === 'Identifier') {
    return (arg as Node & { name: string }).name === interactionName;
  }
  if (arg.type === 'ObjectExpression') {
    const obj = arg as Node & { properties: Node[] };
    return obj.properties.some(prop => {
      if (prop.type !== 'Property') {
        return false;
      }
      const value = (prop as Node & { value: Node }).value;
      return (
        value.type === 'Identifier' && (value as Node & { name: string }).name === interactionName
      );
    });
  }
  return false;
}

/**
 * True if the argument is a call of `interaction.<method>()` for a method in the
 * given set. Fail CLOSED: only matches when interactionName is positively
 * identified — a null name (destructured / unresolved param) never matches, so
 * an arbitrary object's `.reply()` is not mistaken for THE interaction's ack.
 * `passesInteractionToCallee` is fail-closed for the same reason.
 */
function isInteractionMethodCall(
  argument: Node | null | undefined,
  interactionName: string | null,
  methods: ReadonlySet<string>
): boolean {
  if (argument?.type !== 'CallExpression') {
    return false;
  }
  const callee = (argument as Node & { callee: Node }).callee;
  if (callee.type !== 'MemberExpression') {
    return false;
  }
  const member = callee as Node & { object: Node; property: Node & { name?: string } };
  const objectName =
    member.object.type === 'Identifier' ? (member.object as Node & { name: string }).name : null;
  return (
    interactionName !== null &&
    objectName === interactionName &&
    member.property.type === 'Identifier' &&
    methods.has(member.property.name ?? '')
  );
}

/** True if the awaited expression is a BARE ack call on the interaction (`interaction.deferUpdate()`). */
function isBareAckCall(argument: Node | null | undefined, interactionName: string | null): boolean {
  return isInteractionMethodCall(argument, interactionName, ACK_METHODS);
}

/**
 * True if the awaited expression is a bare-ack-equivalent WRAPPER call
 * (`ackUpdate(interaction)` / `ackDeferReply(interaction)`) — an Identifier
 * callee in ACK_WRAPPER_FUNCTIONS. These stamp the defer kind but are otherwise
 * a raw ack with no timeout safety net, so they must be treated exactly like a
 * bare ack (flagged when they follow real async work), NOT lumped in with the
 * late-safe `*WithTimeoutCatch` wrappers that `passesInteractionToCallee` exempts.
 */
function isAckWrapperCall(argument: Node | null | undefined): boolean {
  if (argument?.type !== 'CallExpression') {
    return false;
  }
  const callee = (argument as Node & { callee: Node }).callee;
  return (
    callee.type === 'Identifier' &&
    ACK_WRAPPER_FUNCTIONS.has((callee as Node & { name: string }).name)
  );
}

/**
 * True if the awaited expression is a POST-ack response on the interaction
 * (`interaction.followUp()` / `editReply()` / `deleteReply()`) — a response, not
 * a fetch. The visitor treats it as neutral (see RESPONSE_METHODS).
 */
function isPostAckResponseCall(
  argument: Node | null | undefined,
  interactionName: string | null
): boolean {
  return isInteractionMethodCall(argument, interactionName, RESPONSE_METHODS);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a bare interaction acknowledgement after async work in a component/modal handler — ack first, or wrap a necessarily-late ack in a timeout-catch helper (Discord 3-second rule)',
      recommended: true,
    },
    messages: {
      ackAfterAsync:
        "This handler does awaited work (often a Redis/DB/gateway call) BEFORE this bare interaction ack — that risks blowing Discord's 3-second budget before the ack lands, and the user gets a silent failure. Either move the ack (deferUpdate/deferReply/reply/update/showModal, or the ackUpdate/ackDeferReply wrappers) ahead of the awaited work, or — if the data is needed to shape the ack (e.g. a modal's prefilled fields) — route it through a *WithTimeoutCatch wrapper so a blown budget degrades to a followUp. (followUp/editReply are post-ack and exempt; sync-only guards may precede the ack.)",
    },
    schema: [],
  },

  create(context) {
    const stack: HandlerFrame[] = [];

    function enterFunction(node: Node): void {
      const fn = node as FunctionNode;
      const isHandler = isRouterEntry(fn) || firstParamIsAckInteraction(fn);
      stack.push({
        isHandler,
        interactionName: isHandler ? firstParamName(fn) : null,
        sawRealAsync: false,
      });
    }

    function exitFunction(): void {
      stack.pop();
    }

    return {
      ArrowFunctionExpression: enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,
      FunctionExpression: enterFunction,
      'FunctionExpression:exit': exitFunction,
      FunctionDeclaration: enterFunction,
      'FunctionDeclaration:exit': exitFunction,

      AwaitExpression(node) {
        // Only the NEAREST enclosing function's frame matters — an await inside a
        // nested callback belongs to that callback, not the handler.
        const frame = stack[stack.length - 1];
        if (!frame?.isHandler) {
          return;
        }
        // Unwrap optional-chaining: `interaction?.deferUpdate()` parses as
        // AwaitExpression → ChainExpression → CallExpression, so peel the
        // ChainExpression to inspect the underlying call (else it falls through
        // to real-async and both mis-classifies the ack and over-flags).
        const raw = (node as Node & { argument?: Node }).argument;
        const argument =
          raw?.type === 'ChainExpression' ? (raw as Node & { expression: Node }).expression : raw;

        // A bare ack AFTER real async work is the bug. The ackUpdate/ackDeferReply
        // wrappers are bare-ack-equivalent (no timeout safety net), so they count
        // here too — otherwise `passesInteractionToCallee` below would wrongly
        // exempt them as late-safe wrappers and blind the rule to the whole
        // deferUpdate path (which no-raw-defer-update now funnels through them).
        if (isBareAckCall(argument, frame.interactionName) || isAckWrapperCall(argument)) {
          if (frame.sawRealAsync) {
            context.report({ node, messageId: 'ackAfterAsync' });
          }
          return;
        }

        // A post-ack response (followUp/editReply/deleteReply) is a response, not
        // a fetch — neither a bare ack nor real async work, so skip it. This is
        // what keeps the `if (acked) followUp else reply` helper shape from
        // leaking sawRealAsync onto the sibling else-branch's bare reply.
        if (isPostAckResponseCall(argument, frame.interactionName)) {
          return;
        }

        // A call passed the whole interaction is a wrapper/delegation (legitimate
        // ack point or handoff) — neither real async work nor a bare ack. Skip it.
        if (passesInteractionToCallee(argument, frame.interactionName)) {
          return;
        }

        // Otherwise it's real async work (a data/IO op). Mark it so a following
        // bare ack is flagged.
        frame.sawRealAsync = true;
      },
    };
  },
};

export default rule;
