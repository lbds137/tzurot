import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OPENROUTER_ROUTING } from '@tzurot/common-types/constants/openrouterRouting';
import { parseSummary } from './summary.js';
import {
  TOOL_NAME,
  OPENROUTER_ENDPOINTS_TIMEOUT_MS,
  buildModelEndpointsUrl,
  deriveHostSlugFromTag,
  deriveServedSlugs,
  evaluateOpenRouterRoutingLiveness,
  checkOpenRouterRouting,
} from './check-openrouter-routing.js';

function jsonResponse(status: number, body: unknown, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildModelEndpointsUrl', () => {
  it('builds the literal unencoded OpenRouter endpoints URL for z-ai/glm-5.3-flash', () => {
    expect(buildModelEndpointsUrl('z-ai/glm-5.3-flash')).toBe(
      'https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints'
    );
  });

  it('encodes each slash-separated path segment while preserving the slash separator', () => {
    expect(buildModelEndpointsUrl('a b/zo:nk')).toBe(
      'https://openrouter.ai/api/v1/models/a%20b/zo%3Ank/endpoints'
    );
  });
});

describe('deriveHostSlugFromTag', () => {
  it('returns the prefix before "/" when a slash is present', () => {
    expect(deriveHostSlugFromTag('relace/fp4')).toBe('relace');
    expect(deriveHostSlugFromTag('Relace/fp4')).toBe('relace');
    expect(deriveHostSlugFromTag('baseten/fp8')).toBe('baseten');
    expect(deriveHostSlugFromTag('BASETEN/fp8')).toBe('baseten');
    expect(deriveHostSlugFromTag('open-inference/int8/extra')).toBe('open-inference');
    expect(deriveHostSlugFromTag('Open-Inference/int8/extra')).toBe('open-inference');
  });

  it('returns the whole tag when no slash is present', () => {
    expect(deriveHostSlugFromTag('together')).toBe('together');
    expect(deriveHostSlugFromTag('Together')).toBe('together');
    expect(deriveHostSlugFromTag('TOGETHER')).toBe('together');
    expect(deriveHostSlugFromTag('z-ai')).toBe('z-ai');
    expect(deriveHostSlugFromTag('Z-AI')).toBe('z-ai');
  });

  it('returns null for non-string or empty tags', () => {
    expect(deriveHostSlugFromTag(undefined)).toBeNull();
    expect(deriveHostSlugFromTag(null)).toBeNull();
    expect(deriveHostSlugFromTag(42)).toBeNull();
    expect(deriveHostSlugFromTag({ tag: 'relace' })).toBeNull();
    expect(deriveHostSlugFromTag('')).toBeNull();
    expect(deriveHostSlugFromTag('/fp4')).toBeNull();
  });
});

describe('deriveServedSlugs', () => {
  it('collects distinct host slugs across slash-tagged and bare-tagged endpoints, skipping non-string tags', () => {
    const endpoints = [
      { tag: 'relace/fp4', provider_name: 'Relace', status: 0 },
      { tag: 'baseten/fp8', provider_name: 'BaseTen', status: 0 },
      { tag: 'baseten/bf16', provider_name: 'BaseTen', status: -1 },
      { tag: 'together', provider_name: 'Together', status: 2 },
      { tag: 123, provider_name: 'NumericTag' },
      { provider_name: 'MissingTag' },
      null,
      'not-an-object',
    ];

    expect([...deriveServedSlugs(endpoints)].sort()).toEqual(['baseten', 'relace', 'together']);
  });
});

describe('checkOpenRouterRouting', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let capturedLogs: string[];

  beforeEach(() => {
    mockFetch = vi.fn();
    capturedLogs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args.map(a => String(a)).join(' '));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('passes (status: ok, findings: 0) when every pinned slug is served by at least one endpoint', async () => {
    const allowlist = OPENROUTER_ROUTING.PINNED_MODELS['z-ai/glm-5.3-flash'];
    const endpoints = allowlist.map((slug, idx) => ({
      tag: idx % 2 === 0 ? `${slug}/fp8` : slug,
      provider_name: slug,
      status: idx % 3,
    }));
    mockFetch.mockResolvedValue(
      jsonResponse(200, { data: { id: 'z-ai/glm-5.3-flash', endpoints } })
    );

    const result = await checkOpenRouterRouting({
      summary: true,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    );
    // Unauthenticated endpoint: no Authorization header is sent.
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');

    expect(result.status).toBe('ok');
    expect(result.findings).toBe(0);
    expect(process.exitCode).toBeUndefined();

    const summary = parseSummary(capturedLogs.at(-1)!);
    expect(summary).toEqual({
      tool: TOOL_NAME,
      status: 'ok',
      findings: 0,
      baseline: 0,
    });
  });

  it('matches host slugs case-insensitively on endpoints and pinnedModels allowlists', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'z-ai/glm-5.3-flash',
          endpoints: [{ tag: 'Relace/fp4' }, { tag: 'together' }],
        },
      })
    );

    const result = await checkOpenRouterRouting({
      summary: true,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['relace', 'TOGETHER'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.status).toBe('ok');
    expect(result.findings).toBe(0);
    expect(process.exitCode).toBeUndefined();
    expect(result.models[0]).toEqual({
      modelId: 'z-ai/glm-5.3-flash',
      available: true,
      pinnedCount: 2,
      servedCount: 2,
      missingSlugs: [],
    });

    const summary = parseSummary(capturedLogs.at(-1)!);
    expect(summary).toEqual({
      tool: TOOL_NAME,
      status: 'ok',
      findings: 0,
      baseline: 0,
    });
  });

  it('fails (status: fail) and names the missing slugs when allowlisted slugs are absent from live endpoints', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'z-ai/glm-5.3-flash',
          endpoints: [{ tag: 'z-ai/fp8' }, { tag: 'together' }, { tag: 'deepinfra/fp8' }],
        },
      })
    );

    const result = await checkOpenRouterRouting({
      summary: true,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['z-ai', 'together', 'relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.status).toBe('fail');
    expect(result.findings).toBe(2);
    expect(process.exitCode).toBe(1);

    const reportText = capturedLogs.join('\n');
    expect(reportText).toContain('relace');
    expect(reportText).toContain('baseten');
    expect(reportText).toContain('note: served but unpinned: deepinfra');

    const summary = parseSummary(capturedLogs.at(-1)!);
    expect(summary).toEqual({
      tool: TOOL_NAME,
      status: 'fail',
      findings: 2,
      baseline: 0,
    });
  });

  it('omits served-but-unpinned note on fail when every served slug is allowlisted (pure retirement)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'z-ai/glm-5.3-flash',
          endpoints: [{ tag: 'z-ai/fp8' }, { tag: 'together' }],
        },
      })
    );

    const result = await checkOpenRouterRouting({
      summary: true,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['z-ai', 'together', 'relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.status).toBe('fail');
    expect(result.findings).toBe(2);

    const reportText = capturedLogs.join('\n');
    expect(reportText).toContain('relace');
    expect(reportText).toContain('baseten');
    expect(reportText).not.toContain('served but unpinned');
  });

  it('degrades to a non-failing, non-broken warn summary when fetch rejects (offline/network error)', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed: ENOTFOUND openrouter.ai'));

    const result = await checkOpenRouterRouting({
      summary: true,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.status).toBe('warn');
    expect(result.findings).toBe(0);
    expect(process.exitCode).toBeUndefined();

    const reportText = capturedLogs.join('\n');
    expect(reportText).toContain('unavailable');
    expect(reportText).toContain('ENOTFOUND openrouter.ai');

    const summary = parseSummary(capturedLogs.at(-1)!);
    expect(summary).toEqual({
      tool: TOOL_NAME,
      status: 'warn',
      findings: 0,
      baseline: 0,
    });
  });

  it('degrades to a non-failing warn summary on an AbortError timeout or non-200 HTTP response', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const timeoutResult = await evaluateOpenRouterRoutingLiveness({
      timeoutMs: 5000,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    expect(timeoutResult.status).toBe('warn');
    expect(timeoutResult.findings).toBe(0);
    expect(timeoutResult.models[0]).toEqual({
      modelId: 'z-ai/glm-5.3-flash',
      available: false,
      reason: 'request timed out after 5000ms',
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse(503, { error: 'unavailable' }, 'Service Unavailable')
    );
    const httpErrorResult = await evaluateOpenRouterRoutingLiveness({
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    expect(httpErrorResult.status).toBe('warn');
    expect(httpErrorResult.findings).toBe(0);
    expect(httpErrorResult.models[0]).toEqual({
      modelId: 'z-ai/glm-5.3-flash',
      available: false,
      httpStatus: 503,
      reason: 'HTTP 503 Service Unavailable',
    });
  });

  it('fails (status: fail, findings: 0) when a pinned model id returns HTTP 404 on OpenRouter', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: 'not found' }, 'Not Found'));

    const result = await checkOpenRouterRouting({
      summary: true,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.status).toBe('fail');
    expect(result.findings).toBe(0);
    expect(process.exitCode).toBe(1);
    expect(result.models[0]).toEqual({
      modelId: 'z-ai/glm-5.3-flash',
      available: false,
      httpStatus: 404,
      reason: 'HTTP 404 Not Found',
    });

    const reportText = capturedLogs.join('\n');
    expect(reportText).toContain('z-ai/glm-5.3-flash');
    expect(reportText).toContain('not found');
    expect(reportText).toContain('HTTP 404 Not Found');

    const summary = parseSummary(capturedLogs.at(-1)!);
    expect(summary).toEqual({
      tool: TOOL_NAME,
      status: 'fail',
      findings: 0,
      baseline: 0,
    });
  });

  it('degrades to status: warn when OpenRouter returns HTTP 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(429, { error: 'rate limited' }, 'Too Many Requests')
    );

    const result = await checkOpenRouterRouting({
      summary: true,
      pinnedModels: {
        'z-ai/glm-5.3-flash': ['relace', 'baseten'],
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.status).toBe('warn');
    expect(result.findings).toBe(0);
    expect(process.exitCode).toBeUndefined();
    expect(result.models[0]).toEqual({
      modelId: 'z-ai/glm-5.3-flash',
      available: false,
      httpStatus: 429,
      reason: 'HTTP 429 Too Many Requests',
    });

    const summary = parseSummary(capturedLogs.at(-1)!);
    expect(summary).toEqual({
      tool: TOOL_NAME,
      status: 'warn',
      findings: 0,
      baseline: 0,
    });
  });

  describe('multi-model aggregation', () => {
    it('reports status: fail when one model has missing slugs and another degrades with 5xx', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: {
              id: 'z-ai/glm-5.3-flash',
              endpoints: [{ tag: 'relace/fp4' }],
            },
          })
        )
        .mockResolvedValueOnce(jsonResponse(503, { error: 'unavailable' }, 'Service Unavailable'));

      const result = await checkOpenRouterRouting({
        summary: true,
        pinnedModels: {
          'z-ai/glm-5.3-flash': ['relace', 'baseten'],
          'vendor-b/model-b': ['together', 'fireworks'],
        },
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.status).toBe('fail');
      expect(result.findings).toBe(1);
      expect(process.exitCode).toBe(1);

      const reportText = capturedLogs.join('\n');
      expect(reportText).toContain(
        '❌ z-ai/glm-5.3-flash: 1/2 pinned host slug(s) absent from live endpoints: baseten'
      );
      expect(reportText).toContain(
        '⚠️  vendor-b/model-b: endpoints check unavailable (HTTP 503 Service Unavailable)'
      );

      const summary = parseSummary(capturedLogs.at(-1)!);
      expect(summary).toEqual({
        tool: TOOL_NAME,
        status: 'fail',
        findings: 1,
        baseline: 0,
      });
    });

    it('sums missing-slug findings across multiple reachable models (1 + 2 = 3)', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: {
              id: 'z-ai/glm-5.3-flash',
              endpoints: [{ tag: 'relace/fp4' }],
            },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            data: {
              id: 'vendor-b/model-b',
              endpoints: [{ tag: 'together' }],
            },
          })
        );

      const result = await checkOpenRouterRouting({
        summary: true,
        pinnedModels: {
          'z-ai/glm-5.3-flash': ['relace', 'baseten'],
          'vendor-b/model-b': ['together', 'fireworks', 'deepinfra'],
        },
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.status).toBe('fail');
      expect(result.findings).toBe(3);
      expect(process.exitCode).toBe(1);

      const reportText = capturedLogs.join('\n');
      expect(reportText).toContain(
        '❌ z-ai/glm-5.3-flash: 1/2 pinned host slug(s) absent from live endpoints: baseten'
      );
      expect(reportText).toContain(
        '❌ vendor-b/model-b: 2/3 pinned host slug(s) absent from live endpoints: fireworks, deepinfra'
      );

      const summary = parseSummary(capturedLogs.at(-1)!);
      expect(summary).toEqual({
        tool: TOOL_NAME,
        status: 'fail',
        findings: 3,
        baseline: 0,
      });
    });
  });

  it.each([
    {
      caseName: 'response body is not a JSON object',
      body: null,
      expectedReason: 'response body is not a JSON object',
    },
    {
      caseName: 'response body is missing data object',
      body: { unexpected: true },
      expectedReason: 'response body is missing data object',
    },
    {
      caseName: 'response body data.endpoints is not an array',
      body: { data: { id: 'z-ai/glm-5.3-flash', endpoints: { not: 'an-array' } } },
      expectedReason: 'response body data.endpoints is not an array',
    },
  ])(
    'degrades to a non-failing warn summary when 200 payload is malformed ($caseName)',
    async ({ body, expectedReason }) => {
      mockFetch.mockResolvedValue(jsonResponse(200, body));

      const result = await checkOpenRouterRouting({
        summary: true,
        pinnedModels: {
          'z-ai/glm-5.3-flash': ['relace', 'baseten'],
        },
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.status).toBe('warn');
      expect(result.findings).toBe(0);
      expect(process.exitCode).toBeUndefined();
      expect(result.models[0]).toEqual({
        modelId: 'z-ai/glm-5.3-flash',
        available: false,
        reason: expectedReason,
      });

      const reportText = capturedLogs.join('\n');
      expect(reportText).toContain(expectedReason);

      const summary = parseSummary(capturedLogs.at(-1)!);
      expect(summary).toEqual({
        tool: TOOL_NAME,
        status: 'warn',
        findings: 0,
        baseline: 0,
      });
    }
  );

  it('aborts the fetch signal on timeout and degrades to status: warn', async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | null | undefined;
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      });

      const pending = checkOpenRouterRouting({
        summary: true,
        pinnedModels: {
          'z-ai/glm-5.3-flash': ['relace', 'baseten'],
        },
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(OPENROUTER_ENDPOINTS_TIMEOUT_MS);
      const result = await pending;

      expect(capturedSignal?.aborted).toBe(true);
      expect(result.status).toBe('warn');
      expect(result.findings).toBe(0);
      expect(process.exitCode).toBeUndefined();
      expect(result.models[0]).toEqual({
        modelId: 'z-ai/glm-5.3-flash',
        available: false,
        reason: `request timed out after ${String(OPENROUTER_ENDPOINTS_TIMEOUT_MS)}ms`,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
