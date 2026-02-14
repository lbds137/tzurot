/**
 * Tests for OpenRouterFetch
 *
 * Verifies custom fetch wrapper behavior:
 * - Response cloning (body preserved on parse failure)
 * - 400 content recovery (valid content extracted from error responses)
 * - Reasoning injection into content
 *
 * Moved from ModelFactory.test.ts to colocate with the extracted module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @tzurot/common-types
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

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

  it('should preserve response body when interception succeeds (clone behavior)', async () => {
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
    const choices = resultBody.choices as Array<{ message: { content: string } }>;

    expect(result.status).toBe(200);
    // Reasoning should be injected into content
    expect(choices[0].message.content).toContain('<reasoning>');
    expect(choices[0].message.content).toContain('Hello world');
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

  it('should inject reasoning into recovered 400 content', async () => {
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
    const choices = body.choices as Array<{ message: { content: string } }>;
    expect(choices[0].message.content).toContain('<reasoning>Deep thinking here</reasoning>');
    expect(choices[0].message.content).toContain('Hello world');
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

  it('should use reasoning as content when 200 response has reasoning only (empty content)', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: '',
            reasoning: 'This is the actual dialogue response',
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{ message: { content: string } }>;
    // Should use reasoning directly as content — no <reasoning> tags
    expect(choices[0].message.content).toBe('This is the actual dialogue response');
    expect(choices[0].message.content).not.toContain('<reasoning>');
  });

  it('should recover reasoning from 400 response when content is empty', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: '',
            reasoning: 'Model put dialogue here by mistake',
          },
        },
      ],
      error: { message: 'Some provider error' },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    // Should synthesize a 200 response with reasoning as content
    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{ message: { content: string } }>;
    expect(choices[0].message.content).toBe('Model put dialogue here by mistake');
    expect(choices[0].message.content).not.toContain('<reasoning>');
  });

  it('should wrap reasoning in tags when both reasoning and content are present (regression guard)', async () => {
    const customFetch = createFetch();

    const responseBody = {
      choices: [
        {
          message: {
            content: 'Actual response content',
            reasoning: 'Internal thinking process',
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

    const result = await customFetch('https://api.test.com/v1/chat', {
      method: 'GET',
    });

    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    const choices = body.choices as Array<{ message: { content: string } }>;
    // When both exist, reasoning should be wrapped in tags and content preserved
    expect(choices[0].message.content).toBe(
      '<reasoning>Internal thinking process</reasoning>\nActual response content'
    );
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
});
