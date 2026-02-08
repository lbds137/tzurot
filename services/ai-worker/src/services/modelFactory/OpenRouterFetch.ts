/**
 * OpenRouter custom fetch wrapper.
 *
 * Two responsibilities:
 * 1. REQUEST: Inject OpenRouter-specific params (transforms, route, verbosity)
 * 2. RESPONSE: Extract reasoning content that LangChain would otherwise drop
 *
 * LangChain's Chat Completions converter only preserves function_call/tool_calls/audio
 * from the message object — the `reasoning` and `reasoning_details` fields are silently
 * lost. We intercept the raw response to inject reasoning into message.content as
 * <reasoning> tags, which thinkingExtraction.ts then processes.
 */

import { createLogger } from '@tzurot/common-types';

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
      '[ModelFactory] Custom fetch injecting OpenRouter params'
    );

    init.body = JSON.stringify(body);
  } catch {
    // If body isn't JSON, pass through unchanged
  }
}

/**
 * Extract reasoning text from OpenRouter's reasoning_details array.
 * Handles multiple detail types: reasoning.text, reasoning.summary.
 * Encrypted blocks (reasoning.encrypted) are skipped (unreadable).
 */
function extractReasoningFromDetails(details: unknown[]): string | null {
  const texts: string[] = [];
  for (const item of details) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const detail = item as Record<string, unknown>;
    if (detail.type === 'reasoning.text' && typeof detail.text === 'string') {
      texts.push(detail.text);
    } else if (detail.type === 'reasoning.summary' && typeof detail.summary === 'string') {
      texts.push(detail.summary);
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

/**
 * Extract reasoning from a single response message and inject it into content.
 * Returns true if reasoning was found and injected.
 *
 * Handles two response formats:
 * - message.reasoning (string) — DeepSeek R1, Kimi K2, QwQ, GLM
 * - message.reasoning_details (array) — Claude Extended Thinking, Gemini, o-series
 */
function injectReasoningIntoMessage(message: Record<string, unknown>): boolean {
  logger.info(
    {
      messageKeys: Object.keys(message),
      hasReasoning: typeof message.reasoning === 'string',
      reasoningLength: typeof message.reasoning === 'string' ? message.reasoning.length : 0,
      hasReasoningDetails: Array.isArray(message.reasoning_details),
    },
    '[ModelFactory] Inspecting response message for reasoning content'
  );

  let reasoning: string | null = null;

  // Source 1: message.reasoning (string — DeepSeek R1, Kimi K2, QwQ)
  if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
    reasoning = message.reasoning;
  }
  // Source 2: message.reasoning_details (array — Claude, Gemini, o-series)
  else if (Array.isArray(message.reasoning_details)) {
    reasoning = extractReasoningFromDetails(message.reasoning_details);
  }

  if (reasoning === null) {
    return false;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  message.content = `<reasoning>${reasoning}</reasoning>\n${content}`;

  logger.debug(
    { reasoningLength: reasoning.length, contentLength: content.length },
    '[ModelFactory] Injected reasoning from API response into content'
  );

  return true;
}

/**
 * Intercept OpenRouter API response to preserve reasoning content.
 *
 * LangChain's Chat Completions converter only extracts function_call, tool_calls,
 * and audio from the response message — reasoning fields are silently dropped.
 * We intercept the raw response to extract reasoning and inject it into the
 * message content as <reasoning> tags, which thinkingExtraction.ts then processes.
 */
function interceptReasoningResponse(responseBody: Record<string, unknown>): boolean {
  const choices = responseBody.choices;
  if (!Array.isArray(choices)) {
    return false;
  }

  let modified = false;
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null) {
      continue;
    }
    const msg = (choice as Record<string, unknown>).message;
    if (typeof msg !== 'object' || msg === null) {
      continue;
    }
    if (injectReasoningIntoMessage(msg as Record<string, unknown>)) {
      modified = true;
    }
  }
  return modified;
}

/**
 * Try to recover valid content from a 400-class error response.
 *
 * Some models (free-tier GLM, etc.) return HTTP 400 with usable content in
 * choices[].message.content that would otherwise be lost when LangChain throws
 * on the error status code. If content is found, returns a synthetic 200 Response.
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
    const content = msg?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return null;
    }

    logger.warn(
      { status: response.status, contentLength: content.length },
      '[ModelFactory] Recovered valid content from error response — synthesizing 200'
    );
    interceptReasoningResponse(body);
    return new Response(JSON.stringify(body), {
      status: 200,
      statusText: 'OK',
      headers: response.headers,
    });
  } catch {
    return null;
  }
}

/**
 * Create a custom fetch function for OpenRouter requests.
 *
 * Two responsibilities:
 * 1. REQUEST: Inject OpenRouter-specific params (transforms, route, verbosity)
 * 2. RESPONSE: Extract reasoning content that LangChain would otherwise drop
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
    logger.info(
      { url: urlStr, method: init?.method },
      '[ModelFactory] Custom fetch intercepting request'
    );

    const response = await fetch(url, init);

    // RESPONSE: Intercept to preserve reasoning content
    const contentType = response.headers.get('content-type');
    logger.info(
      {
        status: response.status,
        ok: response.ok,
        contentType,
      },
      '[ModelFactory] Custom fetch received response'
    );

    // For 400-class errors with JSON body, try to recover valid content
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
      return response;
    }
    if (contentType === null) {
      return response;
    }
    if (!contentType.includes('application/json')) {
      return response;
    }

    // Clone before consuming so the original body stays intact on parse failure
    const clone = response.clone();
    try {
      const body = (await clone.json()) as Record<string, unknown>;
      const modified = interceptReasoningResponse(body);

      logger.info({ reasoningInjected: modified }, '[ModelFactory] Response interception complete');

      return new Response(JSON.stringify(body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      logger.warn(
        { err },
        '[ModelFactory] Failed to parse response JSON for reasoning interception'
      );
      return response;
    }
  };
}
