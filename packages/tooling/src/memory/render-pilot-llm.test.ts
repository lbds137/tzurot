import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../utils/errors.js';
import {
  callOpenRouter,
  requireApiKey,
  appendUsageRecord,
  clearStageUsage,
  runWithConcurrencySettled,
  stripThinkingBlocks,
} from './render-pilot-llm.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function okBody(content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    choices: [{ message: { content }, ...extra }],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  };
}

describe('requireApiKey', () => {
  const original = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = original;
    }
  });

  it('throws UsageError naming the variable when unset', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => requireApiKey()).toThrow(UsageError);
    expect(() => requireApiKey()).toThrow(/OPENROUTER_API_KEY/);
  });

  it('returns the key when set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    expect(requireApiKey()).toBe('sk-test');
  });
});

describe('stripThinkingBlocks', () => {
  it('strips a <think> block and counts it', () => {
    const result = stripThinkingBlocks('<think>internal chatter</think>the real reply');
    expect(result.content).toBe('the real reply');
    expect(result.reasoningBlocksStripped).toBe(1);
  });

  it('strips a <character_analysis> block (one of the nine mirrored tags)', () => {
    const result = stripThinkingBlocks('<character_analysis>notes</character_analysis>reply text');
    expect(result.content).toBe('reply text');
    expect(result.reasoningBlocksStripped).toBe(1);
  });

  it('counts zero blocks for a normal body', () => {
    const result = stripThinkingBlocks('just a normal reply');
    expect(result.content).toBe('just a normal reply');
    expect(result.reasoningBlocksStripped).toBe(0);
  });
});

describe('callOpenRouter', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('parses a successful response into content + usage + finishReason', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, okBody('hi', { finish_reason: 'stop' })));
    const result = await callOpenRouter(
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0,
        maxTokens: 10,
      },
      'sk-test'
    );
    expect(result).toMatchObject({
      content: 'hi',
      promptTokens: 5,
      completionTokens: 3,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: 'stop',
    });
  });

  it('sends response_format only when jsonMode is requested', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, okBody('{}')));
    await callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10, jsonMode: true },
      'sk-test'
    );
    const [, jsonModeInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const jsonModeBody = JSON.parse(jsonModeInit.body as string) as Record<string, unknown>;
    expect(jsonModeBody.response_format).toEqual({ type: 'json_object' });

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(jsonResponse(200, okBody('{}')));
    await callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test');
    const [, noJsonModeInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const noJsonModeBody = JSON.parse(noJsonModeInit.body as string) as Record<string, unknown>;
    expect(noJsonModeBody).not.toHaveProperty('response_format');
  });

  it('defaults finishReason to null when absent or not a string', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, okBody('hi')));
    const result = await callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    expect(result.finishReason).toBeNull();
  });

  it('throws with the first 300 chars of the raw body on a shape mismatch, without retrying', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/unexpected/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws an exhausted-budget error naming the model when finish_reason is "length" and content is empty', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        model: 'z-ai/glm-5.3',
        choices: [{ message: {}, finish_reason: 'length' }],
        usage: { prompt_tokens: 5, completion_tokens: 200 },
      })
    );
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/exhausted the token budget/);
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/z-ai\/glm-5\.3/);
  });

  it('throws the exhausted-budget error with no model artifact when the model field is absent', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: {}, finish_reason: 'length' }],
        usage: { prompt_tokens: 5, completion_tokens: 200 },
      })
    );
    let message = '';
    try {
      await callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/exhausted the token budget/);
    expect(message).not.toMatch(/undefined/);
    expect(message).not.toMatch(/null/);
  });

  it('throws the ordinary shape-mismatch error when content is empty and finish_reason is not "length"', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      })
    );
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/did not carry choices\[0\]\.message\.content/);
  });

  it('throws loudly when content is empty and reasoning carries the whole reply (never silently promotes)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: '', reasoning: 'the whole answer ended up here' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      })
    );
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/reasoning/);
  });

  // Canary (F1a): deleting the empty-content-with-"length" branch in
  // parseCompletionBody must redden this test — an empty string is a
  // `typeof === 'string'` content, so only this explicit check catches it.
  it('throws an exhausted-budget error when content is empty and finish_reason is "length"', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, okBody('', { finish_reason: 'length' })));
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/exhausted the token budget/);
  });

  it('resolves with empty content when finish_reason is "stop" (a legitimate, if odd, empty reply)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, okBody('', { finish_reason: 'stop' })));
    const result = await callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    expect(result.content).toBe('');
  });

  // Canary: mutating MAX_ATTEMPTS (or the retry-eligibility check) must redden this test.
  it('retries a 429 exactly 3 attempts total, then throws', async () => {
    mockFetch.mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
    const promise = callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    const assertion = expect(promise).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable 4xx', async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { error: 'bad request' }));
    await expect(
      callOpenRouter({ model: 'm', messages: [], temperature: 0, maxTokens: 10 }, 'sk-test')
    ).rejects.toThrow(/400/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('succeeds after one retryable 5xx failure', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(503, { error: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(200, okBody('ok')));
    const promise = callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.content).toBe('ok');
    expect(result.attempts).toBe(2);
  });

  // Canary (F1): a network-level failure (rejected fetch) must be retried
  // exactly like an HTTP error — mutating the retry to only catch HTTP
  // statuses must redden this test.
  it('retries a rejected fetch (network error) twice then succeeds on the third attempt', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down again'))
      .mockResolvedValueOnce(jsonResponse(200, okBody('ok')));
    const promise = callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.content).toBe('ok');
    expect(result.attempts).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects a fetch that fails on all 3 attempts with the last network error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const promise = callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    const assertion = expect(promise).rejects.toThrow(/network down/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // Canary: setting MAX_ATTEMPTS to a literal 4 (decoupling it from
  // BACKOFF_MS.length) must redden this test.
  it('sleeps exactly [2000, 6000] between the three retry attempts', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    mockFetch.mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
    const promise = callOpenRouter(
      { model: 'm', messages: [], temperature: 0, maxTokens: 10 },
      'sk-test'
    );
    const assertion = expect(promise).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;
    // 120_000 is the per-call abort timer's delay, armed once per attempt.
    const delays = spy.mock.calls.map(c => c[1]);
    expect(delays.filter(d => d !== 120_000)).toEqual([2000, 6000]);
    spy.mockRestore();
  });
});

describe('appendUsageRecord', () => {
  it('appends one JSON line per call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-pilot-usage-'));
    const path = join(dir, 'usage.jsonl');
    try {
      appendUsageRecord(path, {
        stage: 'summaries',
        model: 'm',
        promptTokens: 1,
        completionTokens: 2,
        latencyMs: 100,
        attempts: 1,
        reasoningBlocksStripped: 0,
        timestamp: '2026-01-01T00:00:00.000Z',
      });
      appendUsageRecord(path, {
        stage: 'summaries',
        model: 'm',
        promptTokens: 3,
        completionTokens: 4,
        latencyMs: 100,
        attempts: 1,
        reasoningBlocksStripped: 1,
        timestamp: '2026-01-01T00:00:01.000Z',
      });
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ promptTokens: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('clearStageUsage', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-clear-usage-'));
    path = join(dir, 'usage.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when the file does not exist', () => {
    expect(() => clearStageUsage(path, 'answers')).not.toThrow();
  });

  it("removes only the named stage's lines, preserving the others in order", () => {
    const record = (stage: string, n: number) =>
      JSON.stringify({
        stage,
        model: 'm',
        promptTokens: n,
        completionTokens: n,
        latencyMs: 1,
        attempts: 1,
        reasoningBlocksStripped: 0,
        timestamp: 't',
      });
    writeFileSync(
      path,
      [record('summaries', 1), record('answers', 2), record('judge', 3), record('answers', 4)].join(
        '\n'
      ) + '\n'
    );

    clearStageUsage(path, 'answers');

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const stages = lines.map(line => JSON.parse(line) as { stage: string; promptTokens: number });
    expect(stages.map(s => s.stage)).toEqual(['summaries', 'judge']);
    expect(stages.map(s => s.promptTokens)).toEqual([1, 3]);
  });

  it('keeps a malformed line rather than dropping it', () => {
    writeFileSync(path, 'not json\n');
    clearStageUsage(path, 'answers');
    expect(readFileSync(path, 'utf8').trim()).toBe('not json');
  });
});

describe('runWithConcurrencySettled', () => {
  it('runs every task and preserves result order regardless of completion order', async () => {
    const deferred = [0, 1, 2].map(() => {
      let resolve: (value: number) => void = () => {};
      const promise = new Promise<number>(r => {
        resolve = r;
      });
      return { promise, resolve };
    });
    const tasks = deferred.map(d => () => d.promise);
    const resultPromise = runWithConcurrencySettled(tasks, 3);
    // Resolve out of completion order — index 2 first, then 0, then 1.
    deferred[2].resolve(3);
    deferred[0].resolve(1);
    deferred[1].resolve(2);
    await expect(resultPromise).resolves.toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
      { ok: true, value: 3 },
    ]);
  });

  it('never runs more than `concurrency` tasks at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];
    const tasks = Array.from(
      { length: 6 },
      () => () =>
        new Promise<null>(resolve => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve(null);
          });
        })
    );
    const promise = runWithConcurrencySettled(tasks, 2);
    for (let i = 0; i < tasks.length; i++) {
      while (resolvers.length <= i) {
        await Promise.resolve();
      }
      resolvers[i]();
    }
    await promise;
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('records a rejection at its own index without sinking the other tasks', async () => {
    const tasks = [
      () => Promise.resolve('a'),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve('c'),
    ];
    const results = await runWithConcurrencySettled(tasks, 3);
    expect(results).toEqual([
      { ok: true, value: 'a' },
      { ok: false, error: 'boom' },
      { ok: true, value: 'c' },
    ]);
  });
});
