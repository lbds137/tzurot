/**
 * OpenRouter custom fetch wrapper.
 *
 * Two responsibilities:
 * 1. REQUEST: Inject OpenRouter-specific params (transforms, route, verbosity)
 *    that aren't first-class options on LangChain's ChatOpenAI but are part of
 *    OpenRouter's request body schema.
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

import { MAX_ERROR_MESSAGE_LENGTH } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { extractApiReasoningContent } from '../../utils/thinkingExtraction.js';

const logger = createLogger('ModelFactory');

/**
 * OpenRouter-specific parameters injected into the request body via custom fetch.
 */
export interface OpenRouterExtraParams {
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
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
  try {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    if (extraParams.transforms !== undefined && extraParams.transforms.length > 0) {
      body.transforms = extraParams.transforms;
    }
    if (extraParams.route !== undefined) {
      body.route = extraParams.route;
    }
    if (extraParams.verbosity !== undefined) {
      body.verbosity = extraParams.verbosity;
    }

    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : '[Request]';
    logger.info(
      {
        url: urlStr,
        injectedParams: extraParams,
      },
      'Custom fetch injecting OpenRouter params'
    );

    init.body = JSON.stringify(body);
  } catch (err) {
    // Body isn't a JSON-parseable string. LangChain's ChatOpenAI always passes
    // a string body today, so this should never fire — but if a future LangChain
    // version uses Uint8Array / ReadableStream / etc., we'd silently skip
    // OpenRouter param injection (transforms/route/verbosity) without this debug
    // breadcrumb. Logged at debug rather than warn because the fallback (passing
    // body through unchanged) is correct; this is purely an observability hook.
    logger.debug(
      {
        err,
        // constructor.name surfaces "Uint8Array" / "ReadableStream" / "Blob"
        // — actionable for diagnosing why; typeof would just say "object"
        bodyType:
          init.body === null || init.body === undefined
            ? typeof init.body
            : ((init.body as object).constructor?.name ?? typeof init.body),
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
    if (
      hasExtraParams &&
      init?.method === 'POST' &&
      init.body !== undefined &&
      init.body !== null
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
