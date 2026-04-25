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

import { createLogger } from '@tzurot/common-types';
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
async function tryRecoverErrorContent(response: Response): Promise<Response | null> {
  try {
    const clone = response.clone();
    const body = (await clone.json()) as Record<string, unknown>;
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

    if (!response.ok) {
      const isJsonClientError =
        response.status >= 400 &&
        response.status < 500 &&
        contentType?.includes('application/json') === true;
      if (isJsonClientError) {
        const recovered = await tryRecoverErrorContent(response);
        if (recovered !== null) {
          return recovered;
        }
      }
    }
    return response;
  };
}
