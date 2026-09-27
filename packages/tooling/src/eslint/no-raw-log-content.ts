/**
 * ESLint Rule: no-raw-log-content
 *
 * The structural funnel for `contentPreview` / `contentDigest`
 * (`packages/common-types/src/utils/logContentPreview.ts`): user-authored
 * content must reach a log line only through those gates, so deployed logs
 * carry no message / persona / response text by default. A hand-run grep was
 * the only check before this rule, and it missed sites of exactly the shapes
 * flagged here.
 *
 * Two sinks: the first argument of a log call
 * (`<receiver>.info|warn|error|debug|trace|fatal(...)`), and every argument of
 * `new <Name>Error(...)` — the thrown message later rides `err: error` into a
 * log line. Both patterns apply at both sinks, each reported at the offending
 * expression:
 *
 *   A. RAW TRUNCATION — `x.slice(0, n)` / `x.substring(0, n)` whose receiver
 *      TYPE is string (type-aware). An array `ids.slice(0, 5)` is not content
 *      and passes. Reported as `rawTruncation` at a log sink and
 *      `rawTruncationInError` at an Error sink, whose remedy differs (below).
 *
 *   B. RAW RESPONSE BODY — an identifier bound from `await <x>.text()` (or
 *      `await <x>.text().catch(...)`) referenced, unwrapped. A truncated body
 *      (`body.slice(0, n)`) reports once, as Pattern A.
 *
 * A `.length` read (`body.length`, `firstPart.trimEnd().length`) is a size,
 * not content: nothing under it is a finding or followed through the hop below.
 *
 * Both patterns follow ONE hop: an identifier at a sink that resolves to a
 * same-file `const` is replaced by that const's initializer (the
 * `const qPreview = query.substring(0, n)` → `{ queryPreview: qPreview }`
 * shape), the same one-hop mechanism `no-raw-content-literals` uses.
 *
 * Exempt, per sink (`SinkPolicy`): anything inside a call to `contentDigest`,
 * at either sink; anything inside a call to `contentPreview`, at a log sink
 * only. At an Error sink a `contentPreview(...)` call is itself a finding
 * (`previewInError`): a preview belongs in one log field, while an Error
 * message rides `.message` into every `logger.error({ err })` that handles it.
 * The non-content prefix helpers `idPrefix` / `urlPrefix` need no exemption —
 * they are not `.slice` / `.substring` calls, so an id or URL prefix routed
 * through them is never a finding — and deliberately get none: a response
 * body passed into one (`urlPrefix(body, n)`) is still Pattern B.
 *
 * Option `{ errorSinks?: boolean }` (default `true`): `false` skips every
 * Error-constructor sink — no truncation, `.text()` body or preview check runs
 * there — while log sinks are unaffected. `eslint.config.js` sets it `false`
 * for `packages/tooling/**`: an operator CLI that no deployed service depends
 * on, whose Error messages print to the operator's terminal. Pinned by the
 * `errorSinks option` describe in `no-raw-log-content.test.ts`.
 *
 * Pattern C — RAW FILENAME READ, at both sinks: a non-computed property
 * read of `name` / `filename` / `fileName` / `originalName` off a "file-ish"
 * object (an identifier, or the last segment of a member chain, named
 * `attachment` / `att` / `file` / `upload`, or ending in `Attachment` /
 * `File` — case-sensitive, so `profile.name` does not match but
 * `firstFile.name` does). A filename is user-authored content — the stem can
 * carry arbitrary text — so the sanctioned route is `filenameShape(name)`
 * (`@tzurot/common-types/utils/logContentPreview`), which reduces it to an
 * extension and a length; a call to `filenameShape` is exempt at both sinks,
 * like `contentDigest`. Reported as `rawFilename` at a log sink and
 * `rawFilenameInError` at an Error sink, whose remedy differs: an Error
 * message can carry `filenameShape(name)?.extension` (or omit the filename
 * entirely) but never the raw name — the message rides `err` into every log
 * line that handles it. `errorSinks: false` skips this check at the Error
 * sink along with every other Error-sink check (below). The one-hop const
 * mechanism above applies here too (`const n = file.name; logger.warn({ n })`),
 * plus a destructuring-specific shorthand consuming the same one-hop budget:
 * `const { name } = attachment; logger.info({ name })` is flagged by
 * resolving the destructured property back to its file-ish source, but a
 * second hop through it (`const { name } = attachment; const w = name;
 * logger.info({ w })`) is not, matching the plain-const two-hop case.
 * Optional chaining (`attachment?.name`) is followed through its
 * `ChainExpression` wrapper. The walk also enters a call's arguments, so a
 * filename passed into any call whose result is logged is flagged even when
 * the callee never logs it — wrap it at that call.
 *
 * What the rule cannot see (by design — the reach is per-file, per-sink).
 * Each limit is pinned as a passing case in `no-raw-log-content.test.ts`:
 *   - cross-function flow: a helper that returns `text.slice(0, n)`, or a
 *     body passed as a parameter into another function before being logged;
 *   - a body assigned after declaration (`let b; b = await res.text()`);
 *   - a `let` binding, or more than one hop
 *     (`const a = s.slice(0, 9); const b = a; log({ b })`);
 *   - log-call arguments after the first (the pino message string);
 *   - truncation through other helpers (`truncateText(s, n)`), which are
 *     not `.slice` / `.substring` calls;
 *   - a filename read through a COMPUTED member (`attachments[0].name`);
 *   - a filename destructured from a function PARAMETER
 *     (`({ name }: Attachment) => ...`) rather than a `const` declarator.
 *
 * Receiver typing: when the file has no type program (the rule enabled in a
 * block without `projectService`), every `.slice(0, n)` / `.substring(0, n)`
 * receiver is treated as a string — fail closed, never silently skip.
 */

import type { Rule, Scope } from 'eslint';
import { type MessageId, MESSAGES } from './no-raw-log-content-messages.js';

/** Pino-style log methods; the receiver name is deliberately NOT matched. */
const LOG_METHODS = new Set(['info', 'warn', 'error', 'debug', 'trace', 'fatal']);

/** Truncating string methods whose `(0, n)` form is the raw-preview shape. */
const TRUNCATION_METHODS = new Set(['slice', 'substring']);

/** The digest gate (a hash, not the text): exempt at every sink. */
const DIGEST_CALLEE = 'contentDigest';

/** The dev-gated preview gate: sanctioned in a log field, a finding in an Error message. */
const PREVIEW_CALLEE = 'contentPreview';

/** The filename gate (extension + length, never the stem): exempt at every sink. */
const FILENAME_SHAPE_CALLEE = 'filenameShape';

/** Non-computed property names that read a filename off a file-ish object. */
const FILENAME_PROPS = new Set(['name', 'filename', 'fileName', 'originalName']);

/** What one kind of sink reports for a raw truncation, a `contentPreview` call, and a raw filename read. */
interface SinkPolicy {
  truncation: MessageId;
  /** `null` when `contentPreview` is sanctioned at this sink (its subtree is skipped). */
  preview: MessageId | null;
  /** `null` when a filename read is out of scope at this sink (Error sinks). */
  filename: MessageId | null;
}

/** The rule's one option; `errorSinks: false` skips every Error-constructor sink. */
interface RuleOptions {
  errorSinks?: boolean;
}

const LOG_SINK: SinkPolicy = {
  truncation: 'rawTruncation',
  preview: null,
  filename: 'rawFilename',
};
const ERROR_SINK: SinkPolicy = {
  truncation: 'rawTruncationInError',
  preview: 'previewInError',
  filename: 'rawFilenameInError',
};

interface AstNode {
  type: string;
  parent?: AstNode;
  [key: string]: unknown;
}

/** The TypeChecker surface the receiver check uses (structural, no runtime import). */
interface TypeLike {
  readonly flags: number;
}
interface CheckerLike {
  getTypeAtLocation(node: unknown): TypeLike;
  getNonNullableType(type: TypeLike): TypeLike;
  getStringType(): TypeLike;
  isTypeAssignableTo(source: TypeLike, target: TypeLike): boolean;
}
interface ParserServicesLike {
  program?: { getTypeChecker(): CheckerLike } | null;
  esTreeNodeToTSNodeMap?: { get(node: unknown): unknown };
}

interface Finding {
  node: AstNode;
  messageId: MessageId;
}

/** Per-file state a sink walk needs: scope lookup, the type checker, visitor keys. */
interface WalkEnv {
  context: Rule.RuleContext;
  checker: CheckerLike | null;
  nodeMap: { get(node: unknown): unknown } | null;
  visitorKeys: Record<string, readonly string[]>;
}

/**
 * A walk's position: `hops` is how many const initializers may still be
 * entered; `sink` is the policy of the sink the walk started from, carried
 * through the hop. `out` is shared across the whole walk.
 */
interface WalkState {
  hops: number;
  sink: SinkPolicy;
  out: Finding[];
}

function calleeName(node: AstNode): string | undefined {
  const callee = node.callee as AstNode | undefined;
  if (callee === undefined) {
    return undefined;
  }
  if (callee.type === 'Identifier') {
    return callee.name as string;
  }
  if (callee.type === 'MemberExpression' && callee.computed !== true) {
    const property = callee.property as AstNode;
    return property.type === 'Identifier' ? (property.name as string) : undefined;
  }
  return undefined;
}

/** `x.slice(0, n)` / `x.substring(0, n)` — returns the receiver, or null. */
function truncationReceiver(node: AstNode): AstNode | null {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node.callee as AstNode;
  if (callee.type !== 'MemberExpression' || callee.computed === true) {
    return null;
  }
  const property = callee.property as AstNode;
  if (property.type !== 'Identifier' || !TRUNCATION_METHODS.has(property.name as string)) {
    return null;
  }
  const args = node.arguments as AstNode[];
  const first = args[0];
  if (args.length !== 2 || first.type !== 'Literal' || first.value !== 0) {
    return null;
  }
  return callee.object as AstNode;
}

/** `await x.text()` or `await x.text().catch(...)` — the raw-body binding shape. */
function isTextBodyInit(init: AstNode | null | undefined): boolean {
  if (init?.type !== 'AwaitExpression') {
    return false;
  }
  let call = init.argument as AstNode;
  if (call.type === 'CallExpression' && calleeName(call) === 'catch') {
    call = (call.callee as AstNode).object as AstNode;
  }
  return (
    call.type === 'CallExpression' &&
    calleeName(call) === 'text' &&
    (call.arguments as AstNode[]).length === 0
  );
}

/**
 * The name that decides whether an object is "file-ish": an Identifier's own
 * name, or — for a non-computed member chain (`msg.attachment`) — its last
 * property name. A computed object (`attachments[0]`) has no such name.
 */
function fileIshObjectName(node: AstNode): string | undefined {
  if (node.type === 'Identifier') {
    return node.name as string;
  }
  if (node.type === 'MemberExpression' && node.computed !== true) {
    const property = node.property as AstNode;
    return property.type === 'Identifier' ? (property.name as string) : undefined;
  }
  return undefined;
}

/** `attachment`, `att`, `file`, `upload`, or a name ending in `Attachment`/`File` (case-sensitive). */
function isFileIshName(name: string): boolean {
  return (
    name === 'attachment' ||
    name === 'att' ||
    name === 'file' ||
    name === 'upload' ||
    name.endsWith('Attachment') ||
    name.endsWith('File')
  );
}

/** `attachment.name`, `att.filename`, `msg.attachment.name` — a filename read off a file-ish object. */
function isFilenameRead(node: AstNode): boolean {
  if (node.type !== 'MemberExpression' || node.computed === true) {
    return false;
  }
  const property = node.property as AstNode;
  if (property.type !== 'Identifier' || !FILENAME_PROPS.has(property.name as string)) {
    return false;
  }
  const objectName = fileIshObjectName(node.object as AstNode);
  return objectName !== undefined && isFileIshName(objectName);
}

/** `new Error(...)`, `new GatewayError(...)`, `new errors.FooError(...)`. */
function isErrorConstruction(node: AstNode): boolean {
  if (node.type !== 'NewExpression') {
    return false;
  }
  return calleeName(node)?.endsWith('Error') === true;
}

function isLogCall(node: AstNode): boolean {
  const callee = node.callee as AstNode;
  if (callee.type !== 'MemberExpression' || callee.computed === true) {
    return false;
  }
  const property = callee.property as AstNode;
  return property.type === 'Identifier' && LOG_METHODS.has(property.name as string);
}

/** Child keys that hold types, never runtime values. */
const TYPE_KEYS = new Set(['typeAnnotation', 'typeArguments', 'typeParameters', 'returnType']);

/**
 * The child keys of `node` that can hold value references. A non-computed
 * property key or member property is a NAME, so it is skipped — which also
 * makes a shorthand `{ body }` count once, through its value.
 */
function valueKeys(node: AstNode, visitorKeys: Record<string, readonly string[]>): string[] {
  const computed = node.computed === true;
  if (node.type === 'Property') {
    return computed ? ['key', 'value'] : ['value'];
  }
  if (node.type === 'MemberExpression') {
    if (computed) {
      return ['object', 'property'];
    }
    // `<anything>.length` is a size, not content: `body.length`,
    // `firstPartRaw.trimEnd().length` — the object is never inspected.
    const property = node.property as AstNode;
    return property.type === 'Identifier' && property.name === 'length' ? [] : ['object'];
  }
  return (visitorKeys[node.type] ?? []).filter(key => !TYPE_KEYS.has(key));
}

function resolveVariable(context: Rule.RuleContext, identifier: AstNode): Scope.Variable | null {
  const name = identifier.name as string;
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

/** The initializer and declaration kind of a same-file variable, or null. */
function variableInit(
  env: WalkEnv,
  identifier: AstNode
): { init: AstNode | null | undefined; kind: string | undefined } | null {
  const def = resolveVariable(env.context, identifier)?.defs[0];
  if (def?.type !== 'Variable') {
    return null;
  }
  return {
    init: (def.node as { init?: AstNode | null }).init,
    kind: (def.parent as { kind?: string }).kind,
  };
}

/** Type-aware string check; with no type program every receiver counts (fail closed). */
function isStringReceiver(env: WalkEnv, receiver: AstNode): boolean {
  const tsNode = env.nodeMap?.get(receiver);
  if (env.checker === null || tsNode === undefined) {
    return true;
  }
  const type = env.checker.getNonNullableType(env.checker.getTypeAtLocation(tsNode));
  return env.checker.isTypeAssignableTo(type, env.checker.getStringType());
}

/** True when a filename read at a log sink is reported here; anything else walks on as before. */
function collectMemberExpression(node: AstNode, state: WalkState): boolean {
  if (state.sink.filename === null || !isFilenameRead(node)) {
    return false;
  }
  state.out.push({ node, messageId: state.sink.filename });
  return true;
}

/** Walk a sink subtree collecting findings into `state.out`. */
function collect(env: WalkEnv, node: AstNode, state: WalkState): void {
  if (node.type === 'CallExpression' && collectCall(env, node, state)) {
    return;
  }
  if (node.type === 'MemberExpression' && collectMemberExpression(node, state)) {
    return;
  }
  if (node.type === 'Identifier') {
    collectIdentifier(env, node, state);
    return;
  }
  for (const key of valueKeys(node, env.visitorKeys)) {
    const child = node[key] as AstNode | (AstNode | null)[] | null | undefined;
    for (const item of Array.isArray(child) ? child : [child]) {
      if (item !== null && item !== undefined && typeof item.type === 'string') {
        collect(env, item, state);
      }
    }
  }
}

/**
 * True when the call is fully handled here — exempt, or reported as a
 * preview or a truncation. A reported call's content argument is not
 * re-walked, so one site is one finding: a truncated body (`body.slice(0, n)`)
 * reports once as a truncation, and `contentPreview(body, n)` at an Error sink
 * once as a preview.
 */
function collectCall(env: WalkEnv, node: AstNode, state: WalkState): boolean {
  const name = calleeName(node);
  if (name === DIGEST_CALLEE || name === FILENAME_SHAPE_CALLEE) {
    return true;
  }
  if (name === PREVIEW_CALLEE) {
    if (state.sink.preview !== null) {
      state.out.push({ node, messageId: state.sink.preview });
    }
    return true;
  }
  const receiver = truncationReceiver(node);
  if (receiver === null || !isStringReceiver(env, receiver)) {
    return false;
  }
  state.out.push({ node, messageId: state.sink.truncation });
  for (const arg of node.arguments as AstNode[]) {
    collect(env, arg, state);
  }
  return true;
}

/**
 * `const { name } = attachment;` — resolves an identifier back to the
 * declarator's `init` when it was destructured from a filename-prop key
 * (`name` / `filename` / `fileName` / `originalName`, plain or via an
 * `AssignmentPattern` default) matching this identifier's own name. Returns
 * `null` when the identifier isn't such a destructured binding at all — a
 * plain `const` (`const n = file.name`) or a function-parameter pattern
 * (`({ name }: Attachment) => ...`, not a `VariableDeclarator`) don't match.
 */
function destructuredFilenameSource(env: WalkEnv, identifier: AstNode): AstNode | null {
  const def = resolveVariable(env.context, identifier)?.defs[0];
  if (def?.type !== 'Variable') {
    return null;
  }
  const declaratorId = (def.node as unknown as { id: AstNode }).id;
  const declaratorInit = (def.node as { init?: AstNode | null }).init;
  if (
    declaratorId.type !== 'ObjectPattern' ||
    declaratorInit === null ||
    declaratorInit === undefined
  ) {
    return null;
  }
  const name = identifier.name as string;
  const matched = (declaratorId.properties as AstNode[]).some(property => {
    if (property.type !== 'Property' || property.computed === true) {
      return false;
    }
    const key = property.key as AstNode;
    if (key.type !== 'Identifier' || !FILENAME_PROPS.has(key.name as string)) {
      return false;
    }
    let value = property.value as AstNode;
    if (value.type === 'AssignmentPattern') {
      value = value.left as AstNode;
    }
    return value.type === 'Identifier' && value.name === name;
  });
  return matched ? declaratorInit : null;
}

/** A `.text()` body is a finding; a `const` is entered once (the one hop). */
function collectIdentifier(env: WalkEnv, node: AstNode, state: WalkState): void {
  const destructuredSource = state.hops > 0 ? destructuredFilenameSource(env, node) : null;
  if (destructuredSource !== null) {
    const objectName = fileIshObjectName(destructuredSource);
    if (objectName !== undefined && isFileIshName(objectName) && state.sink.filename !== null) {
      state.out.push({ node, messageId: state.sink.filename });
      return;
    }
  }
  const binding = variableInit(env, node);
  if (binding === null) {
    return;
  }
  if (isTextBodyInit(binding.init)) {
    state.out.push({ node, messageId: 'rawResponseBody' });
    return;
  }
  if (
    state.hops > 0 &&
    binding.kind === 'const' &&
    binding.init !== null &&
    binding.init !== undefined
  ) {
    collect(env, binding.init, { ...state, hops: state.hops - 1 });
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw string truncation, raw response bodies, or raw filename reads reaching log fields and Error messages, and contentPreview reaching Error messages — route content through contentPreview (log fields only), contentDigest, or filenameShape (filenames; only its extension in an Error message)',
      recommended: true,
    },
    messages: MESSAGES,
    schema: [
      {
        type: 'object',
        properties: { errorSinks: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] ?? {}) as RuleOptions;
    const errorSinks = options.errorSinks !== false;
    const services = context.sourceCode.parserServices as ParserServicesLike | undefined;
    const env: WalkEnv = {
      context,
      checker: services?.program?.getTypeChecker() ?? null,
      nodeMap: services?.esTreeNodeToTSNodeMap ?? null,
      visitorKeys: context.sourceCode.visitorKeys,
    };
    /** Distinct flagged nodes (a const's init dedupes across its sinks). */
    const reported = new Set<AstNode>();

    function walk(sinks: AstNode[], policy: SinkPolicy): void {
      const out: Finding[] = [];
      for (const sink of sinks) {
        collect(env, sink, { hops: 1, sink: policy, out });
      }
      for (const finding of out) {
        if (reported.has(finding.node)) {
          continue;
        }
        reported.add(finding.node);
        context.report({
          node: finding.node as unknown as Rule.Node,
          messageId: finding.messageId,
        });
      }
    }

    return {
      CallExpression(node) {
        const call = node as unknown as AstNode;
        const first = (call.arguments as AstNode[])[0];
        if (first !== undefined && isLogCall(call)) {
          walk([first], LOG_SINK);
        }
      },

      NewExpression(node) {
        const construction = node as unknown as AstNode;
        if (errorSinks && isErrorConstruction(construction)) {
          walk(construction.arguments as AstNode[], ERROR_SINK);
        }
      },
    };
  },
};

export default rule;
