/**
 * Canary test for the LangChain `__includeRawResponse` contract.
 *
 * This test instantiates a real `ChatOpenAI` from `@langchain/openai` with
 * `__includeRawResponse: true` and a stubbed fetch returning a known OpenRouter
 * response shape. It then asserts that `result.additional_kwargs.__raw_response`
 * is populated with the expected nested structure (`choices[0].message.reasoning`,
 * `choices[0].message.reasoning_details`, top-level `provider`).
 *
 * **Why this test exists**:
 * `__includeRawResponse` is marked "experimental beta" in `@langchain/openai`'s
 * public types (`dist/types.d.ts:121`). Our reasoning-extraction pipeline depends
 * on the field surfacing OpenRouter's `message.reasoning` field that LangChain
 * would otherwise drop (langchain-ai/langchain#32981). If a future LangChain
 * version bump renames `__includeRawResponse`, removes it, or changes the
 * structure of `additional_kwargs.__raw_response`, our extraction breaks
 * silently — reasoning content vanishes from `/inspect` audit logs, and the
 * model's planning prose may become user-visible.
 *
 * This test is the loudly-failing canary that catches the regression at
 * dependency-update time, before it ships and rots production output quality.
 *
 * If this test fails after a `pnpm update @langchain/openai`:
 * 1. Read the LangChain CHANGELOG for the version range.
 * 2. Check langchain-ai/langchain#32981 — the upstream fix may have landed,
 *    in which case our `extractAndPopulateOpenRouterReasoning` helper can
 *    likely be deleted along with `__includeRawResponse: true`.
 * 3. If `__includeRawResponse` was renamed, update both the constructor in
 *    `ModelFactory.ts` AND the helper's read path in `extractOpenRouterReasoning.ts`.
 * 4. Do NOT just delete this test to make CI green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatOpenAI } from '@langchain/openai';

// Mock our common-types logger to keep test output clean
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('Canary: __includeRawResponse contract with @langchain/openai', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('surfaces OpenRouter raw response into additional_kwargs.__raw_response', async () => {
    // Stubbed OpenRouter chat completions response. Mirrors what a real GLM-4.7
    // request to https://openrouter.ai/api/v1/chat/completions returns.
    const openRouterResponse = {
      id: 'gen-canary-test',
      object: 'chat.completion',
      created: 1234567890,
      model: 'z-ai/glm-4.7',
      provider: 'StubProvider',
      system_fingerprint: 'stub',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'The answer is 42.',
            refusal: null,
            reasoning: 'Computing 6 * 7 = 42.',
            reasoning_details: [{ type: 'reasoning.text', text: 'Computing 6 * 7 = 42.' }],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
      },
    };

    const stubFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(openRouterResponse), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
    );

    // Build a ChatOpenAI exactly as ModelFactory does (minus our custom OpenRouter
    // fetch wrapper, which is unrelated to the __includeRawResponse contract).
    const model = new ChatOpenAI({
      modelName: 'z-ai/glm-4.7',
      apiKey: 'sk-canary-test',
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        fetch: stubFetch as unknown as typeof globalThis.fetch,
      },
      __includeRawResponse: true,
    });

    const result = await model.invoke([{ role: 'user', content: 'What is 6 * 7?' }]);

    // === The contract we depend on ===

    // 1. __raw_response is present in additional_kwargs.
    // If this fails: __includeRawResponse: true was either ignored or renamed.
    const rawResponse = (result.additional_kwargs as Record<string, unknown>).__raw_response;
    expect(
      rawResponse,
      'LangChain dropped __raw_response from additional_kwargs — the __includeRawResponse:true ' +
        'option may have been renamed or removed in @langchain/openai. See file header for triage steps.'
    ).toBeDefined();

    // 2. __raw_response is the parsed JSON body (object), not a Response or string.
    expect(typeof rawResponse).toBe('object');
    expect(rawResponse).not.toBeNull();

    const raw = rawResponse as Record<string, unknown>;

    // 3. choices[0].message.reasoning is at the path we read from.
    // If this fails: LangChain restructured how __raw_response stores the body.
    const choices = raw.choices;
    expect(Array.isArray(choices)).toBe(true);
    const firstChoice = (choices as Array<Record<string, unknown>>)[0];
    expect(firstChoice).toBeDefined();
    const message = firstChoice.message as Record<string, unknown>;
    expect(message).toBeDefined();
    expect(message.reasoning).toBe('Computing 6 * 7 = 42.');

    // 4. choices[0].message.reasoning_details is structured as expected.
    expect(Array.isArray(message.reasoning_details)).toBe(true);
    const details = message.reasoning_details as Array<Record<string, unknown>>;
    expect(details[0]).toEqual({ type: 'reasoning.text', text: 'Computing 6 * 7 = 42.' });

    // 5. Top-level provider field is preserved (this is OpenRouter's, NOT LangChain's
    // hardcoded model_provider="openai" in response_metadata).
    expect(raw.provider).toBe('StubProvider');
  });
});
