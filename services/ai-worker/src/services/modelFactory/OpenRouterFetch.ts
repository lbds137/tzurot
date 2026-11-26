/**
 * OpenRouter custom fetch wrapper.
 *
 * Two responsibilities:
 * 1. REQUEST: Inject OpenRouter-specific params (transforms, route, verbosity,
 *    cache_control, session_id)
 *    that aren't first-class options on LangChain's ChatOpenAI but are part of
 *    OpenRouter's request body schema. When the params carry the `provider`
 *    routing object (privacy routing — `data_collection: 'deny'` plus the
 *    pinned endpoint list), injection FAILS CLOSED: a POST body that cannot
 *    carry it aborts the request instead of shipping unrouted. Tuning-only
 *    params keep the historical fail-open.
 * 2. RESPONSE: Best-effort recovery of usable content from 400-class JSON
 *    error responses. Some free-tier providers (notably GLM variants) return
 *    HTTP 400 with valid `choices[0].message.content` (or reasoning) that
 *    LangChain would otherwise discard by throwing on the error status code.
 *    When found, we synthesize a 200 response so the caller sees the content.
 * 3. RESPONSE (the mirror image): a 200 whose JSON body carries an `error`
 *    object and no `choices` is turned into a real error response, so the
 *    provider's own diagnosis survives instead of collapsing into a generic
 *    empty-response error. See `trySurfaceOkErrorBody`.
 *
 * Reasoning extraction itself lives in `extractOpenRouterReasoning.ts` and runs
 * AFTER LangChain parses the response. This file no longer mutates response
 * bodies for reasoning — that was a transport-layer hack that fought the wrong
 * problem (LangChain's chat completions converter looks for the DeepSeek-legacy
 * `message.reasoning_content` field while OpenRouter normalizes to OpenAI-canonical
 * `message.reasoning`; tracked in langchain-ai/langchain#32981). With
 * `__includeRawResponse: true` set on ChatOpenAI, the raw response surfaces
 * via `additional_kwargs.__raw_response` and the consumer-side helper handles
 * extraction without touching HTTP bytes.
 */

import { PROMPT_CACHE_TTL } from '@tzurot/common-types/constants/ai';
import { MAX_ERROR_MESSAGE_LENGTH } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { extractApiReasoningContent } from '../../utils/thinkingExtraction.js';
import { type OpenRouterProviderRouting } from './providerRouting.js';
import { summarizeProviderRouting } from './providerRoutingSummary.js';

const logger = createLogger('ModelFactory');

/**
 * OpenRouter-specific parameters injected into the request body via custom fetch.
 */
export interface OpenRouterExtraParams {
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
  /**
   * Provider routing object sent as the request root's `provider` field — the
   * host eligibility rules (ignore table / measured pin, `data_collection:
   * 'deny'`) every OpenRouter chat call carries. Resolved per model id by
   * `resolveOpenRouterProviderRouting` and set unconditionally in
   * `buildOpenRouterExtraParams`; the wire field names live on the type.
   */
  provider?: OpenRouterProviderRouting;
  /**
   * Prompt-caching directive (anthropic-family ids only). Applied as explicit
   * per-block breakpoints on selected messages (`attachCacheBreakpoints`),
   * never as a request-root `cache_control`.
   */
  cacheControl?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  /**
   * Conversation-scoped stickiness id sent as the request root's `session_id`.
   * OpenRouter's provider routing otherwise hashes the first system + first
   * non-system message, which churns per turn on this pipeline; an explicit id
   * pins the conversation to one endpoint so the cache can read. Carried only
   * when the prompt-caching gate fires (ModelFactory).
   */
  sessionId?: string;
}

/**
 * Prompt-caching directive copied onto each explicit per-block breakpoint
 * (`attachCacheBreakpoints`); it is not sent as a request-root `cache_control`.
 * The TTL lives here, not at the injection site, and rides on every marked
 * block. The caller gates on the `anthropic/` model-id prefix
 * (ModelFactory.buildOpenRouterModel); the 1h tier prices cache writes at 2x
 * and reads at 0.1x standard input.
 */
export const OPENROUTER_PROMPT_CACHE_CONTROL = {
  /** Anthropic-style ephemeral cache entry. */
  type: 'ephemeral',
  /** Cache entry lifetime — `PROMPT_CACHE_TTL` ('1h') selects the 1-hour pricing
   * tier; omitted, OpenRouter defaults to the 5-minute tier. */
  ttl: PROMPT_CACHE_TTL,
} as const;

/**
 * Attach explicit per-block `cache_control` breakpoints to up to three
 * messages of `body.messages` (wire order is `[system, crossChannel?,
 * ...history, current]` — see `buildInvocationMessages`). Targets, in order:
 *
 * - `[0]` the stable system prompt;
 * - `[1]` the cross-channel `<prior_conversations>` block when present, else
 *   the oldest history head — stable between history eviction steps;
 * - `[length - 2]` the last stable message, so the next turn's lookback reads
 *   through it.
 *
 * The FINAL message is never marked: it carries the per-turn volatile block
 * (memories, facts, datetime), which shrinks once it becomes history, so a
 * cache write there is never read back. For that reason no root-level
 * `cache_control` is sent either. OpenRouter's prompt-caching docs
 * (https://openrouter.ai/docs/features/prompt-caching) describe its automatic
 * mode as placing the breakpoint at the end of the request, i.e. on that final
 * message. Observed in a probe against OpenRouter (not pinned by a test): with
 * these marks, later turns read the prefix through the previous turn's
 * `[length - 2]` mark, including when 25 and 60 messages arrived between the
 * two turns; the root-directive shape rewrote the request every turn.
 * Anthropic documents a lookback of roughly 20 blocks before each breakpoint —
 * if busy-channel cache hit ratios drop, check that limit first. The TTL rides
 * on each block's own copy of the directive. At most three blocks are marked,
 * under Anthropic's max of 4. Returns the number of blocks marked (0 on every
 * early return).
 *
 * Role-guarded: nothing is marked unless `messages[0]` is a `system` or
 * `developer` message. A `promptCaching` caller with no system prompt would
 * otherwise cache-mark churning USER messages that can never read.
 *
 * Per target (`markMessageBlock`): string content becomes a one-block text
 * array carrying the breakpoint; array content gets it on its LAST text
 * block (Anthropic caches the longest prefix ending at the marked block). A
 * target with no text block, non-string/non-array content, or an empty text is
 * skipped while the other targets are still marked. The empty-text skip exists
 * because an empty string would otherwise be wrapped into a new, empty text
 * block that caches nothing (Anthropic's API also refuses empty text blocks;
 * not probed here). Pinned by `OpenRouterFetch.test.ts`
 * § "explicit cache breakpoints + session id".
 */
function attachCacheBreakpoints(
  body: Record<string, unknown>,
  cacheControl: OpenRouterExtraParams['cacheControl']
): number {
  const messages: unknown[] = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  if (messages.length === 0) {
    return 0;
  }
  const first: unknown = messages[0];
  if (typeof first !== 'object' || first === null) {
    return 0;
  }
  const role: unknown = (first as Record<string, unknown>).role;
  if (role !== 'system' && role !== 'developer') {
    return 0;
  }
  const targets = new Set(
    [0, 1, messages.length - 2].filter(index => index >= 0 && index < messages.length - 1)
  );
  let marked = 0;
  for (const index of targets) {
    if (markMessageBlock(messages[index], cacheControl)) {
      marked++;
    }
  }
  return marked;
}

/**
 * Put a `cache_control` copy on one message's text, returning whether a block
 * was marked. See `attachCacheBreakpoints` for the shape rules.
 */
function markMessageBlock(
  message: unknown,
  cacheControl: OpenRouterExtraParams['cacheControl']
): boolean {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const target = message as Record<string, unknown>;
  if (typeof target.content === 'string') {
    if (target.content === '') {
      return false;
    }
    target.content = [{ type: 'text', text: target.content, cache_control: { ...cacheControl } }];
    return true;
  }
  if (!Array.isArray(target.content)) {
    return false;
  }
  const blocks: unknown[] = target.content as unknown[];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block: unknown = blocks[i];
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'text'
    ) {
      const textBlock = block as Record<string, unknown>;
      if (typeof textBlock.text !== 'string' || textBlock.text === '') {
        return false;
      }
      textBlock.cache_control = { ...cacheControl };
      return true;
    }
  }
  return false;
}

/**
 * Base message for the fail-closed refusal of a POST body that cannot carry
 * the `provider` routing object. The suffix names the body's runtime type
 * (`constructor.name` or `typeof`) and the failure reason — never the body
 * content.
 */
const UNROUTED_BODY_ERROR =
  'OpenRouter request body could not carry provider routing; refusing to send unrouted';

/**
 * Runtime type of a request body: `constructor.name` — "Uint8Array" /
 * "ReadableStream" / "Blob" / "Request" — falling back to `typeof` for
 * primitives and constructor-less values. Never the content.
 */
function describeBodyType(value: unknown): string {
  if (value === null || value === undefined) {
    return typeof value;
  }
  return (value as { constructor?: { name?: string } }).constructor?.name ?? typeof value;
}

/**
 * The fail-closed refusal Error: base message + the body's runtime type +
 * the specific failure reason.
 */
function refuseUnrouted(value: unknown, reason: string): Error {
  // Log the root cause before the throw: the caller sees the error only after
  // its own try/catch reshapes it, and this line keeps body type + reason
  // (never body content) searchable at the refusal site itself.
  logger.error(
    { bodyType: describeBodyType(value), reason },
    'Refusing to send OpenRouter request without provider routing'
  );
  return new Error(`${UNROUTED_BODY_ERROR} (body type: ${describeBodyType(value)}; ${reason})`);
}

/**
 * Parse a POST body that MUST carry the `provider` routing object, failing
 * CLOSED when the body cannot: not a string, not valid JSON, or not a JSON
 * object (arrays included — the routing key has no place to attach). This is
 * the boundary that keeps an unparseable body from shipping WITHOUT the
 * privacy routing; pinned by `OpenRouterFetch.test.ts` § "fail-closed
 * provider routing".
 */
function parseRoutableBody(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') {
    throw refuseUnrouted(raw, 'POST body is not a JSON string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw refuseUnrouted(raw, 'JSON.parse failed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw refuseUnrouted(parsed, 'parsed body is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Copy every carried param onto the parsed body; returns the cacheBreakpoints
 * value for the injection log (undefined when `cacheControl` is absent).
 */
function applyExtraParamsToBody(
  body: Record<string, unknown>,
  extraParams: OpenRouterExtraParams
): number | undefined {
  if (extraParams.transforms !== undefined && extraParams.transforms.length > 0) {
    body.transforms = extraParams.transforms;
  }
  if (extraParams.route !== undefined) {
    body.route = extraParams.route;
  }
  if (extraParams.verbosity !== undefined) {
    body.verbosity = extraParams.verbosity;
  }
  if (extraParams.provider !== undefined) {
    body.provider = extraParams.provider;
  }
  let cacheBreakpoints: number | undefined;
  if (extraParams.cacheControl !== undefined) {
    cacheBreakpoints = attachCacheBreakpoints(body, extraParams.cacheControl);
  }
  if (extraParams.sessionId !== undefined) {
    body.session_id = extraParams.sessionId;
  }
  return cacheBreakpoints;
}

/**
 * Apply the carried params to the parsed body, emit the injection log line,
 * and write the re-serialized body back onto init. Shared by both the
 * fail-closed and the fail-open paths.
 */
function logAndSerializeInjectedBody(
  url: string | URL | Request,
  init: RequestInit,
  body: Record<string, unknown>,
  extraParams: OpenRouterExtraParams
): void {
  const cacheBreakpoints = applyExtraParamsToBody(body, extraParams);
  const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : '[Request]';
  const { provider, ...tuningParams } = extraParams;
  logger.info(
    {
      url: urlStr,
      // `provider` is summarized (see `summarizeProviderRouting`) so the log
      // line never carries the full host list; the tuning params pass through.
      injectedParams: { ...tuningParams, provider: summarizeProviderRouting(provider) },
      ...(cacheBreakpoints !== undefined && { cacheBreakpoints }),
    },
    'Custom fetch injecting OpenRouter params'
  );

  init.body = JSON.stringify(body);
}

/**
 * Inject OpenRouter-specific parameters into the request body.
 * Mutates the init object in place.
 */
function injectOpenRouterParams(
  url: string | URL | Request,
  init: RequestInit,
  extraParams: OpenRouterExtraParams
): void {
  if (extraParams.provider !== undefined) {
    // FAIL CLOSED: `provider` carries the privacy routing, so a body that
    // cannot carry it aborts the request here — before any fetch — instead of
    // shipping unrouted. Never reached with a missing body: the caller gates
    // POST calls with routing into this injector regardless of body state, and
    // `parseRoutableBody` refuses those.
    const routed = parseRoutableBody(init.body);
    logAndSerializeInjectedBody(url, init, routed, extraParams);
    return;
  }
  // Tuning-only params (no `provider` routing object): a body that isn't a
  // JSON-parseable string skips injection and passes through unchanged —
  // acceptable ONLY on this branch, where nothing on the request is
  // load-bearing (transforms/route/verbosity/cacheControl are tuning knobs).
  // With `provider` set the branch above fails closed instead, so this
  // fail-open can never let a privacy-routed request ship unrouted. LangChain's
  // ChatOpenAI always passes a string body today; the debug breadcrumb keeps a
  // future non-string shape diagnosable. The whole parse/apply/serialize
  // sequence stays inside one try, preserving the historical all-or-nothing
  // fail-open (e.g. a Uint8Array body JSON-coerces to a number, and the first
  // param assignment throws).
  try {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    logAndSerializeInjectedBody(url, init, body, extraParams);
  } catch (err) {
    logger.debug(
      {
        err,
        // constructor.name surfaces "Uint8Array" / "ReadableStream" / "Blob"
        // — actionable for diagnosing why; typeof would just say "object"
        bodyType: describeBodyType(init.body),
      },
      'injectOpenRouterParams: body is not JSON-parseable, skipping param injection'
    );
  }
}

/**
 * Synthesize a 200 Response from a body object, preserving the original headers.
 */
function synthesize200(body: Record<string, unknown>, original: Response): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: original.headers,
  });
}

/**
 * Synthesize an error Response from a body object, preserving the original headers.
 *
 * The body is serialized as the caller hands it over — which for the
 * 200-with-error-body path means after that caller has stripped
 * `metadata.flagged_input` (see {@link trySurfaceOkErrorBody}). Nothing else is
 * rewritten, because the OpenAI SDK's
 * `APIError.generate(status, body, …)` builds its error from exactly that: it
 * returns a status-specific subclass carrying `.status`, a `.message` of
 * `"<status> <error.message>"`, and `.error` set to the body's `error` object.
 * Probed against the installed SDK rather than taken from its docs; the
 * resulting classification is pinned by the seam test in
 * `OpenRouterFetch.test.ts`.
 */
function synthesizeErrorStatus(
  status: number,
  body: Record<string, unknown>,
  original: Response
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: 'Error',
    headers: original.headers,
  });
}

/** Status used when the body's own `error.code` is not a usable HTTP status. */
const UNMAPPED_ERROR_BODY_STATUS = 502;

/**
 * Parse a clone of the body so the caller's own read is untouched, and log how
 * long the body took to arrive and parse relative to the headers. The custom
 * fetch's "received response" line fires on headers alone; this is the only
 * line that says the body completed. A rejected parse — malformed JSON, or an
 * AbortError when the caller's timeout fires mid-body — is logged with its
 * name rather than swallowed, so a timeout can be attributed to the body
 * never arriving versus a stall after it did. Both lines are asserted in
 * `OpenRouterFetch.test.ts`.
 *
 * `bodyChars` is undefined when the read itself rejected and a number when the
 * body arrived but did not parse, which is the field that separates a body that
 * never arrived from one that arrived malformed. Implementation note: the clone
 * is read as TEXT and that text is parsed, rather than calling `json()` — per
 * the Fetch standard's `json()` definition that is the same single read, not a
 * second one (not probed here), and it is what makes the length measurable.
 */
async function parseClonedBody(
  response: Response,
  fetchedAt: number
): Promise<Record<string, unknown> | null> {
  let text: string | undefined;
  try {
    text = await response.clone().text();
    const body: unknown = JSON.parse(text);
    logger.info(
      { status: response.status, bodyMs: Date.now() - fetchedAt, bodyChars: text.length },
      'Custom fetch body parsed'
    );
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch (err) {
    logger.warn(
      {
        status: response.status,
        bodyMs: Date.now() - fetchedAt,
        // undefined when the text read itself rejected (the body never fully
        // arrived); a number when the body arrived but did not parse.
        bodyChars: text?.length,
        errName: err instanceof Error ? err.name : typeof err,
      },
      'Custom fetch body inspection failed — passing the response through'
    );
    return null;
  }
}

/**
 * Turn an HTTP-200 body that carries an `error` object and no `choices` into a
 * real error response — the mirror image of {@link tryRecoverErrorContent}.
 *
 * OpenRouter's published error reference describes the shape: "If the provider
 * returns headers and then fails, you receive a `200 OK` whose JSON body holds
 * only an `error` object and no `choices`." Left alone, that body reaches
 * @langchain/openai, whose chat-completions converter builds generations from
 * `choices ?? []` — zero generations — so `invokeModelGuarded` throws a generic
 * EMPTY_RESPONSE and the whole diagnosis in `error.code` / `error.message` /
 * `error.metadata` is discarded before anything can classify it.
 *
 * Restating the status the body already describes routes it down the same path
 * a genuine 4xx takes, so `parseApiError` classifies it with no parser change.
 *
 * Returns null — leaving the response untouched — for a body that has choices,
 * a body with no `error` object, or one that will not parse; the downstream
 * zero-choices guard stays the backstop for those. Every branch is pinned by
 * `OpenRouterFetch.test.ts` § "200 with an error body and no choices".
 *
 * `metadata.flagged_input` is a verbatim excerpt of USER INPUT
 * (`00-critical.md` § Logging), and both halves of keeping it out of the logs
 * are handled here: it is absent from the warn payload below, AND it is deleted
 * from the forwarded body before the error response is synthesized. The second
 * half is needed because the OpenAI SDK's `APIError` assigns the parsed body's
 * `error` object to its own enumerable `error` property, and pino's
 * `customErrorSerializer` copies every own enumerable property of a logged error
 * onto the log object unsanitized — so any `logger.error({ err })` site
 * downstream would otherwise print the excerpt (verified against the installed
 * SDK and `logger.ts` at write time). Both halves are asserted by the same
 * suite.
 */
async function trySurfaceOkErrorBody(
  response: Response,
  fetchedAt: number
): Promise<Response | null> {
  try {
    const body = await parseClonedBody(response, fetchedAt);
    if (body === null) {
      return null;
    }

    // Absent, null, or present-but-empty are the three shapes that mean "no
    // generations" — @langchain/openai's chat-completions converter builds from
    // `choices ?? []`, so null is as empty as undefined there. Anything else
    // (including a populated array alongside an `error` field) is a usable
    // response and must pass through.
    const choices = body.choices;
    if (
      choices !== undefined &&
      choices !== null &&
      !(Array.isArray(choices) && choices.length === 0)
    ) {
      return null;
    }

    const error = body.error;
    if (typeof error !== 'object' || error === null) {
      return null;
    }
    const { code, message, metadata } = error as Record<string, unknown>;
    if (typeof message !== 'string') {
      return null;
    }

    const status =
      typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 599
        ? code
        : UNMAPPED_ERROR_BODY_STATUS;
    const meta: Record<string, unknown> =
      typeof metadata === 'object' && metadata !== null
        ? (metadata as Record<string, unknown>)
        : {};

    // Strip the user-input excerpt from the object that gets serialized: when
    // `metadata` is an object `meta` IS `body.error.metadata`, so this deletion
    // reaches the body `synthesizeErrorStatus` stringifies; when it is not an
    // object `meta` is a throwaway `{}` and there is nothing to strip. Asserted
    // on the RETURNED response's JSON by the round-trip test.
    delete meta.flagged_input;

    logger.warn(
      {
        status,
        errorCode: code,
        // Provider-authored and unbounded, so the LOG copy is capped at the same
        // `MAX_ERROR_MESSAGE_LENGTH` the parser applies. The forwarded body keeps
        // the full string: `parseApiError` reads the SDK error's own message and
        // truncates there. Asserted by the cap test in `OpenRouterFetch.test.ts`.
        // eslint-disable-next-line @tzurot/no-raw-log-content -- provider error text capped at MAX_ERROR_MESSAGE_LENGTH; diagnostic, not user content
        errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        providerName: meta.provider_name,
        modelSlug: meta.model_slug,
        routedModel: body.model,
        // Per OpenRouter's published error reference these are short category
        // strings, so they are logged uncapped; not length-verified here.
        reasons: meta.reasons,
      },
      'OpenRouter returned 200 with an error body and no choices — synthesizing error status'
    );
    return synthesizeErrorStatus(status, body, response);
  } catch {
    return null;
  }
}

/**
 * Try to recover valid content from a 400-class error response.
 *
 * Some free-tier providers (notably GLM variants) return HTTP 400 with usable
 * content in `choices[0].message.content` or — when the model put the response
 * in the wrong field — `choices[0].message.reasoning`. LangChain throws on the
 * error status code so the content is lost; we synthesize a 200 instead.
 *
 * In the reasoning-as-response case, we relocate the text to `content` and
 * delete the reasoning field. Otherwise the downstream reasoning extractor
 * would treat the actual response as chain-of-thought and surface it as
 * `thinkingContent` rather than user-visible content.
 */
async function tryRecoverErrorContent(
  response: Response,
  fetchedAt: number
): Promise<Response | null> {
  try {
    const body = await parseClonedBody(response, fetchedAt);
    if (body === null) {
      return null;
    }
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return null;
    }
    const firstChoice = choices[0] as Record<string, unknown> | undefined;
    const msg = firstChoice?.message as Record<string, unknown> | undefined;
    if (msg === undefined) {
      return null;
    }

    const content = msg.content;
    if (typeof content === 'string' && content.length > 0) {
      logger.warn(
        { status: response.status, contentLength: content.length },
        'Recovered valid content from error response — synthesizing 200'
      );
      return synthesize200(body, response);
    }

    // Content empty: model may have placed the response in `reasoning` or
    // `reasoning_details`. We promote here (before LangChain parses the
    // synthetic 200) for the 400-error path. The equivalent promotion for 200
    // responses lives in extractAndPopulateOpenRouterReasoning's
    // populateReasoningFields, which runs after LangChain parse.
    const reasoning = msg.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      msg.content = reasoning;
      delete msg.reasoning;
      delete msg.reasoning_details;
      logger.warn(
        { status: response.status, reasoningLength: reasoning.length },
        'Recovered reasoning-as-response from error — synthesizing 200'
      );
      return synthesize200(body, response);
    }

    // No `reasoning` string but reasoning_details may carry the response
    // (some providers emit only the structured form).
    if (Array.isArray(msg.reasoning_details) && msg.reasoning_details.length > 0) {
      const fromDetails = extractApiReasoningContent(msg.reasoning_details);
      if (fromDetails !== null && fromDetails.length > 0) {
        msg.content = fromDetails;
        delete msg.reasoning;
        delete msg.reasoning_details;
        logger.warn(
          { status: response.status, reasoningLength: fromDetails.length, fromDetails: true },
          'Recovered reasoning_details-as-response from error — synthesizing 200'
        );
        return synthesize200(body, response);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Route a finished response through the two body inspections: the
 * 200-with-error-body surfacing on the ok path, and the 400-class content
 * recovery on the client-error path. Returns the response untouched when
 * neither applies.
 *
 * Both inspections are gated on a JSON content-type. Streaming responses are
 * `text/event-stream`, so that gate is what keeps either from consuming a
 * stream — asserted by the `text/event-stream` case in `OpenRouterFetch.test.ts`.
 */
async function recoverResponse(
  response: Response,
  contentType: string | null,
  fetchedAt: number
): Promise<Response> {
  if (contentType?.includes('application/json') !== true) {
    return response;
  }
  if (response.ok) {
    return (await trySurfaceOkErrorBody(response, fetchedAt)) ?? response;
  }
  if (response.status >= 400 && response.status < 500) {
    return (await tryRecoverErrorContent(response, fetchedAt)) ?? response;
  }
  return response;
}

/**
 * Create a custom fetch function for OpenRouter requests.
 *
 * Injects OpenRouter-specific request params and recovers content from 400-class
 * JSON error responses. Reasoning extraction is handled downstream by
 * `extractAndPopulateOpenRouterReasoning` after LangChain produces the AIMessage —
 * see `extractOpenRouterReasoning.ts`.
 */
export function createOpenRouterFetch(
  extraParams: OpenRouterExtraParams
): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // REQUEST: Inject OpenRouter-specific params
    const hasExtraParams = Object.keys(extraParams).length > 0;
    const carriesRouting = extraParams.provider !== undefined;
    // The effective method, resolved once: per the Fetch standard,
    // `fetch(request, init)` with `init.method` absent uses the Request's own
    // method (probed against Node's undici: the server sees POST for
    // `fetch(new Request(u, { method: 'POST' }), { body })`), so init first,
    // then the Request url, then the GET default. Uppercased so both
    // method-keyed gates below compare against one value.
    const method = (init?.method ?? (url instanceof Request ? url.method : 'GET')).toUpperCase();
    // FAIL CLOSED before anything is sent: with `provider` routing set, a POST
    // whose body arrives inside a Request url (init undefined) has no init body
    // to inject into — shipping it would silently drop the privacy routing.
    // Pinned by `OpenRouterFetch.test.ts` § "fail-closed provider routing".
    if (carriesRouting && init === undefined && url instanceof Request && method === 'POST') {
      throw refuseUnrouted(url, 'body arrived inside the Request url; no init to inject into');
    }
    if (
      hasExtraParams &&
      method === 'POST' &&
      // `init` can still be undefined here (a Request-carried POST carrying
      // only tuning params — the routing shape was already refused above):
      // there is no init body to inject into, so it passes through, and the
      // narrowing satisfies the injector's non-optional `init` below.
      init !== undefined &&
      // Routing POSTs reach the injector whatever the body state — a body that
      // cannot carry routing must abort (fail closed) rather than skip it.
      // Tuning-only POSTs keep the historical present-body gate.
      (carriesRouting || (init.body !== undefined && init.body !== null))
    ) {
      injectOpenRouterParams(url, init, extraParams);
    }

    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : '[Request]';
    logger.info({ url: urlStr, method: init?.method }, 'Custom fetch intercepting request');

    const response = await fetch(url, init);
    // `Date.now()` rather than `performance.now()`: vitest's fake timers fake
    // `Date` by default and leave `performance` real, so the body-timing test
    // can advance the clock deterministically (probed, not assumed).
    const fetchedAt = Date.now();

    // RESPONSE: Recover usable content from 400-class JSON error responses.
    const contentType = response.headers.get('content-type');
    logger.info(
      {
        status: response.status,
        ok: response.ok,
        contentType,
      },
      'Custom fetch received response'
    );

    return recoverResponse(response, contentType, fetchedAt);
  };
}
