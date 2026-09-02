/**
 * Tests for OpenRouterFetch
 *
 * Verifies custom fetch wrapper behavior:
 * - Request-side OpenRouter param injection (transforms, route, verbosity)
 * - 400-class JSON error recovery (synthesizing 200 from error responses
 *   that contain valid `choices[0].message.content` or reasoning-as-response)
 * - Pass-through behavior (non-JSON, 5xx, unparseable bodies)
 *
 * Reasoning extraction itself happens downstream via
 * `extractAndPopulateOpenRouterReasoning` after LangChain produces an AIMessage —
 * not at the HTTP layer. Tests for that helper live in
 * `extractOpenRouterReasoning.test.ts`. Contract tests for the
 * `__includeRawResponse` LangChain option live in
 * `extractOpenRouterReasoning.canary.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiErrorCategory, MAX_ERROR_MESSAGE_LENGTH } from '@tzurot/common-types/constants/error';
import { parseApiError } from '../../utils/apiErrorParser.js';

// Stable hoisted mock object — the file's createLogger factory used to return
// a NEW object per call, so no test could reach the module-level logger.
// `vi.clearAllMocks()` in `beforeEach` resets it between tests.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Mock @tzurot/common-types
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

import { createOpenRouterFetch } from './OpenRouterFetch.js';

describe('OpenRouterFetch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Create a mock Response */
  function mockResponse(body: unknown, status: number, contentType = 'application/json'): Response {
    return new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': contentType },
    });
  }

  /** Create a custom fetch from createOpenRouterFetch (empty params for response-only tests) */
  function createFetch(): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
    return createOpenRouterFetch({});
  }

  it('should pass through 200 responses unchanged (no reasoning mutation)', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: 'Hello world',
            reasoning: 'I thought carefully',
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });
    const resultBody = (await result.json()) as Record<string, unknown>;
    const choices = resultBody.choices as Array<{
      message: { content: string; reasoning: string };
    }>;

    expect(result.status).toBe(200);
    // Body should be unchanged — reasoning extraction happens downstream now
    expect(choices[0].message.content).toBe('Hello world');
    expect(choices[0].message.reasoning).toBe('I thought carefully');
    expect(choices[0].message.content).not.toContain('<reasoning>');
  });

  it('should return original response when JSON parse fails (clone preserves body)', async () => {
    const customFetch = createFetch();

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('not valid json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Should return original response with body intact (since we cloned)
    expect(result.status).toBe(200);
    const text = await result.text();
    expect(text).toBe('not valid json');
  });

  it('should recover valid content from 400 response', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: 'Valid response content',
          },
        },
      ],
      error: { message: 'Some provider error' },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Should synthesize a 200 response with the recovered content
    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{ message: { content: string } }>;
    expect(choices[0].message.content).toBe('Valid response content');
  });

  it('should pass through 400 response when no valid content', async () => {
    const customFetch = createFetch();

    const responseBody = {
      error: { message: 'Context length exceeded' },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Should pass through the error response unchanged
    expect(result.status).toBe(400);
  });

  it('should pass through 400 response with empty content', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: '',
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    expect(result.status).toBe(400);
  });

  it('should pass through 400 response with unparseable JSON body', async () => {
    const customFetch = createFetch();

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('not json at all', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Should fall through and return original error response
    expect(result.status).toBe(400);
  });

  it('should NOT attempt content recovery for 500/502 errors', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: 'This should not be recovered',
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 502));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // 502 is NOT in the 400-499 range, so no recovery attempted
    expect(result.status).toBe(502);
  });

  it('should preserve reasoning untouched in recovered 400 content (extraction happens downstream)', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: 'Hello world',
            reasoning: 'Deep thinking here',
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{ message: { content: string; reasoning: string } }>;
    // Recovery preserves both fields verbatim — extraction happens in the
    // downstream extractAndPopulateOpenRouterReasoning helper after LangChain parse
    expect(choices[0].message.content).toBe('Hello world');
    expect(choices[0].message.reasoning).toBe('Deep thinking here');
    expect(choices[0].message.content).not.toContain('<reasoning>');
  });

  it('should NOT attempt content recovery for non-JSON 400 responses', async () => {
    const customFetch = createFetch();

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('Bad Request', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    expect(result.status).toBe(400);
  });

  it('should recover reasoning-as-response from 400 (relocates to content, clears reasoning)', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: '',
            reasoning: 'Model put dialogue here by mistake',
            reasoning_details: [
              { type: 'reasoning.text', text: 'Model put dialogue here by mistake' },
            ],
          },
        },
      ],
      error: { message: 'Some provider error' },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Synthesizes a 200; relocates reasoning text into `content` and clears
    // `reasoning` + `reasoning_details` so the downstream extractor doesn't
    // ALSO surface the same text as thinking content (which would duplicate the
    // actual response into the audit-trail)
    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{
      message: { content: string; reasoning?: string; reasoning_details?: unknown };
    }>;
    expect(choices[0].message.content).toBe('Model put dialogue here by mistake');
    expect(choices[0].message.reasoning).toBeUndefined();
    expect(choices[0].message.reasoning_details).toBeUndefined();
  });

  it('should recover reasoning_details-only response from 400 (no string `reasoning` field)', async () => {
    const customFetch = createFetch();

    // Some providers emit the response only via reasoning_details, omitting
    // the convenience `reasoning` string. Empty content + reasoning_details
    // only must still be recoverable.
    const responseBody = {
      choices: [
        {
          message: {
            content: '',
            reasoning_details: [{ type: 'reasoning.text', text: 'Recovered from details only' }],
          },
        },
      ],
      error: { message: 'Some provider error' },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{
      message: { content: string; reasoning?: string; reasoning_details?: unknown };
    }>;
    expect(choices[0].message.content).toBe('Recovered from details only');
    expect(choices[0].message.reasoning).toBeUndefined();
    expect(choices[0].message.reasoning_details).toBeUndefined();
  });

  it('should NOT synthesize 200 when 400 has empty content + empty reasoning_details', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: '',
            reasoning_details: [],
          },
        },
      ],
      error: { message: 'Genuine error, nothing to recover' },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Empty reasoning_details = no recovery possible; passes through as 400
    expect(result.status).toBe(400);
  });

  it('should inject OpenRouter params into POST request body', async () => {
    const customFetch = createOpenRouterFetch({
      transforms: ['middle-out'],
      route: 'fallback',
    });

    const requestBody = { model: 'test-model', messages: [] };
    let capturedBody: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(mockResponse({ choices: [] }, 200));
    });

    await customFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!) as Record<string, unknown>;
    expect(parsed.transforms).toEqual(['middle-out']);
    expect(parsed.route).toBe('fallback');
  });

  it('leaves a POST body untouched when extraParams is empty (the vision shape)', async () => {
    const customFetch = createFetch();

    const requestBody = JSON.stringify({ model: 'test-model', messages: [] });
    let capturedBody: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(mockResponse({ choices: [{ message: { content: 'ok' } }] }, 200));
    });

    await customFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: requestBody,
    });

    expect(capturedBody).toBe(requestBody);
    const parsed = JSON.parse(capturedBody!) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('transforms');
    expect(parsed).not.toHaveProperty('route');
    expect(parsed).not.toHaveProperty('verbosity');
  });

  it('should pass body through unchanged when it is not a JSON-parseable string', async () => {
    // Defensive guard: LangChain's ChatOpenAI always passes a string body today,
    // but we don't want a future LangChain version that uses Uint8Array /
    // ReadableStream to crash the fetch — silently skipping param injection
    // is the safe fallback (a debug log breadcrumb makes the skip diagnosable).
    const customFetch = createOpenRouterFetch({
      transforms: ['middle-out'],
      route: 'fallback',
    });

    let capturedBody: unknown;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = init?.body;
      return Promise.resolve(mockResponse({ choices: [] }, 200));
    });

    const nonJsonBody = 'this is not json';
    await customFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: nonJsonBody,
    });

    // Body passes through unchanged — params NOT injected (would have required parsing)
    expect(capturedBody).toBe(nonJsonBody);
  });

  describe('200 with an error body and no choices', () => {
    it('synthesizes an error status from body.error.code, round-tripping the body minus flagged_input', async () => {
      const customFetch = createFetch();

      const responseBody = {
        error: {
          code: 403,
          message: 'Moderation flagged the input',
          metadata: {
            reasons: ['harassment'],
            flagged_input: 'SECRET_USER_TEXT',
            provider_name: 'ProviderX',
            model_slug: 'vendor/model-y',
          },
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(403);
      const body = (await result.json()) as {
        error: { message: string; code: number; metadata: Record<string, unknown> };
      };
      // Asserts on the RETURNED response's JSON, which is the object the OpenAI
      // SDK hangs off APIError.error — this is what a consumer actually sees.
      expect(body.error.metadata.flagged_input).toBeUndefined();
      expect(body.error.metadata.provider_name).toBe('ProviderX');
      expect(body.error.metadata.reasons).toEqual(['harassment']);
      expect(body.error.message).toBe('Moderation flagged the input');
      expect(body.error.code).toBe(403);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('caps the logged errorMessage at MAX_ERROR_MESSAGE_LENGTH while the forwarded body keeps the full string', async () => {
      const customFetch = createFetch();
      const longMessage = 'x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 250);

      const responseBody = {
        error: {
          code: 403,
          message: longMessage,
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      // Log copy: capped at MAX_ERROR_MESSAGE_LENGTH.
      const loggedErrorMessage = (mockLogger.warn.mock.calls[0]?.[0] as { errorMessage: string })
        .errorMessage;
      expect(loggedErrorMessage).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
      expect(loggedErrorMessage).toBe(longMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH));

      // Forwarded body: the full, untruncated string survives to the consumer.
      const body = (await result.json()) as { error: { message: string } };
      expect(body.error.message).toBe(longMessage);
    });

    it('never logs the flagged_input PII excerpt, but does log the safe diagnosis fields', async () => {
      const customFetch = createFetch();

      const responseBody = {
        error: {
          code: 403,
          message: 'Moderation flagged the input',
          metadata: {
            reasons: ['harassment'],
            flagged_input: 'SECRET_USER_TEXT',
            provider_name: 'ProviderX',
            model_slug: 'vendor/model-y',
          },
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      // Negative half: the user-input excerpt never reaches the log payload.
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('SECRET_USER_TEXT');
      // Positive half: the safe diagnosis fields ARE present — a warn that logged
      // nothing at all would trivially pass the negative assertion above alone.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          providerName: 'ProviderX',
          modelSlug: 'vendor/model-y',
          reasons: ['harassment'],
          errorCode: 403,
        }),
        expect.any(String)
      );
    });

    it.each([
      ['a non-HTTP low code', 0],
      ['a non-HTTP high code', 200],
      ['a non-numeric code', 'x'],
    ])('falls back to 502 for %s', async (_label, code) => {
      const customFetch = createFetch();

      const responseBody = { error: { code, message: 'Something went sideways' } };
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(502);
    });

    it('passes through unchanged when choices is an empty array and there is no error field', async () => {
      const customFetch = createFetch();

      const responseBody = { choices: [] };
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(200);
    });

    it('passes through unchanged when choices is populated even alongside an error field', async () => {
      const customFetch = createFetch();

      const responseBody = {
        choices: [{ message: { content: 'still usable' } }],
        error: { code: 403, message: 'irrelevant — choices already usable' },
      };
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(200);
    });

    it('never parses a non-JSON 200 (text/event-stream) — the branch never runs', async () => {
      const customFetch = createFetch();

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(mockResponse({ error: { code: 403 } }, 200, 'text/event-stream'));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(200);
      // The only observable of the surface-error branch running is the warn log —
      // a non-JSON content-type must short-circuit before any parse is attempted.
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('passes through unchanged when the 200 JSON-content-type body is not valid JSON', async () => {
      const customFetch = createFetch();

      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response('this is not json', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(200);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('strips flagged_input as a no-op when body.error has no metadata object', async () => {
      const customFetch = createFetch();

      const responseBody = { error: { code: 503, message: 'Provider fell over' } };
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      expect(result.status).toBe(503);
    });

    it('treats choices: null the same as choices: undefined — no generations', async () => {
      const customFetch = createFetch();

      const responseBody = {
        choices: null,
        error: { code: 403, message: 'Moderation flagged the input' },
      };
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      const result = await customFetch('https://api.test.com/v1/chat', { method: 'GET' });

      // @langchain/openai's converter builds generations from `choices ?? []`,
      // so a null choices array is empty there too.
      expect(result.status).toBe(403);
    });
  });

  describe('synthesized 403 error-body classification (seam test)', () => {
    it('classifies as CONTENT_POLICY at parseApiError', () => {
      // The `openai` package is not resolvable from services/ai-worker (pnpm strict;
      // node_modules here carries @langchain/openai but not openai directly), so
      // importing it would be an undeclared dependency. This constructs the equivalent
      // error shape the OpenAI SDK's `APIError.generate` produces for a 403 body —
      // probed against the installed SDK version: status/message/error mirror
      // `APIError.generate(403, body, undefined, new Headers())`. The SDK attaches
      // the body's `error` object as an own enumerable property on the constructed
      // error, which is why flagged_input must be stripped upstream in
      // trySurfaceOkErrorBody rather than at any log site.
      const body = {
        error: {
          code: 403,
          message: 'Moderation flagged the input',
          metadata: { reasons: ['harassment'] },
        },
      };
      const constructedApiError = Object.assign(new Error('403 Moderation flagged the input'), {
        status: 403,
        error: body.error,
      });

      const parsed = parseApiError(constructedApiError);

      expect(parsed.category).toBe(ApiErrorCategory.CONTENT_POLICY);
    });
  });
});
