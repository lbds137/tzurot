/**
 * OpenRouter chat-completions client for the render pilot: retry on any
 * transient failure (429/5xx, network errors, timeouts), a bounded timeout
 * per call, a small promise pool for concurrency, and a per-call usage log.
 *
 * The response shape (`choices[0].message.content` + `usage.{prompt_tokens,
 * completion_tokens}`) is an external claim this worktree cannot probe live
 * (no API key here) — parsed defensively; a shape mismatch throws with the
 * first 300 chars of the raw body for the operator to inspect.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { UsageError } from '../utils/errors.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 6000, 18000];
const TIMEOUT_MS = 120_000;
const RAW_BODY_PREVIEW_CHARS = 300;

/**
 * Mirrors `KNOWN_THINKING_TAGS` in `services/ai-worker/src/utils/thinkingExtraction.ts`
 * (tooling cannot import ai-worker). Re-sync this list by hand if that one grows —
 * a reasoning tag this pilot doesn't know about would otherwise leak raw
 * `<tag>...</tag>` chain-of-thought into the measured arm content.
 */
const KNOWN_THINKING_TAGS = [
  'think',
  'thinking',
  'ant_thinking',
  'reasoning',
  'thought',
  'reflection',
  'scratchpad',
  'character_analysis',
  'understanding',
] as const;

const THINKING_TAG_RE = new RegExp(`<(${KNOWN_THINKING_TAGS.join('|')})>[\\s\\S]*?<\\/\\1>`, 'gi');

/** Strip every known reasoning-tag block, case-insensitively, across newlines. Returns the stripped text and how many blocks were removed. */
export function stripThinkingBlocks(text: string): {
  content: string;
  reasoningBlocksStripped: number;
} {
  let count = 0;
  const content = text.replace(THINKING_TAG_RE, () => {
    count += 1;
    return '';
  });
  return { content: content.trim(), reasoningBlocksStripped: count };
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  jsonMode?: boolean;
}

export interface CompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  attempts: number;
  reasoningBlocksStripped: number;
  /** `choices[0].finish_reason`, or `null` when absent or not a string. `'length'` signals truncation (mirrors ai-worker's `FINISH_REASONS.LENGTH`). */
  finishReason: string | null;
}

export interface UsageRecord {
  stage: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  attempts: number;
  reasoningBlocksStripped: number;
  timestamp: string;
}

/** Read the OpenRouter API key from the environment, or throw a UsageError naming it. */
export function requireApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (key === undefined || key.length === 0) {
    throw new UsageError('OPENROUTER_API_KEY is not set — required for any non-dry-run stage');
  }
  return key;
}

/** Sleep for `ms` milliseconds — extracted so tests can fake it with `vi.useFakeTimers()`. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface RawOpenRouterResponse {
  choices?: { message?: { content?: unknown; reasoning?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  model?: unknown;
}

interface ParsedCompletionBody {
  content: string;
  promptTokens: number;
  completionTokens: number;
  reasoningBlocksStripped: number;
  finishReason: string | null;
}

/**
 * The `choices[0].message.content` field is missing or not a string. When
 * `finish_reason` is `"length"`, the budget was exhausted before any content
 * was produced — a reasoning model spends `max_tokens` on internal thinking
 * before emitting a reply, so a tight cap can leave zero tokens for output.
 * Split out of {@link parseCompletionBody} to keep its complexity in bounds.
 */
function throwMissingContentError(rawBody: string, parsed: RawOpenRouterResponse): never {
  if (parsed.choices?.[0]?.finish_reason === 'length') {
    const modelClause = typeof parsed.model === 'string' ? ` for model "${parsed.model}"` : '';
    throw new Error(
      `OpenRouter exhausted the token budget${modelClause} before producing any content ` +
        `(finish_reason: "length") — reasoning models spend max_tokens on internal ` +
        `thinking before emitting a reply, so a tight cap can leave zero tokens for ` +
        `output: ${rawBody.slice(0, RAW_BODY_PREVIEW_CHARS)}`
    );
  }
  throw new Error(
    `OpenRouter response did not carry choices[0].message.content: ${rawBody.slice(0, RAW_BODY_PREVIEW_CHARS)}`
  );
}

/**
 * Parse one OpenRouter response body. Deterministic parse failures (bad JSON,
 * a missing field) throw and are NOT retried by the caller — retrying a
 * shape mismatch just triples the spend for the same wrong answer.
 */
function parseCompletionBody(rawBody: string): ParsedCompletionBody {
  let parsed: RawOpenRouterResponse;
  try {
    parsed = JSON.parse(rawBody) as RawOpenRouterResponse;
  } catch {
    throw new Error(
      `OpenRouter response was not valid JSON: ${rawBody.slice(0, RAW_BODY_PREVIEW_CHARS)}`
    );
  }
  const rawContent = parsed.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string') {
    throwMissingContentError(rawBody, parsed);
  }
  const promptTokens = parsed.usage?.prompt_tokens;
  const completionTokens = parsed.usage?.completion_tokens;
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') {
    throw new Error(
      `OpenRouter response did not carry usage.{prompt_tokens,completion_tokens}: ${rawBody.slice(0, RAW_BODY_PREVIEW_CHARS)}`
    );
  }

  const { content, reasoningBlocksStripped } = stripThinkingBlocks(rawContent);
  const rawReasoning = parsed.choices?.[0]?.message?.reasoning;
  if (content.length === 0 && typeof rawReasoning === 'string' && rawReasoning.length > 0) {
    // Production PROMOTES reasoning to content in this case (some free-tier
    // GLM variants put the whole response in `reasoning` —
    // docs/reference/REASONING_MODEL_FORMATS.md). For a measurement pilot a
    // silent promotion would corrupt the arm under test, so this throws
    // loudly instead of quietly substituting reasoning text for content.
    throw new Error(
      `OpenRouter response returned its whole reply in choices[0].message.reasoning, not content: ${rawBody.slice(0, RAW_BODY_PREVIEW_CHARS)}`
    );
  }

  const rawFinishReason = parsed.choices?.[0]?.finish_reason;
  const finishReason = typeof rawFinishReason === 'string' ? rawFinishReason : null;

  return { content, promptTokens, completionTokens, reasoningBlocksStripped, finishReason };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * One OpenRouter call, retried up to {@link MAX_ATTEMPTS} times on 429/5xx
 * responses AND on network-level failures (a rejected `fetch`, an
 * `AbortError` from the timeout) — a single dropped connection must not
 * kill an entire ~2,000-call pilot run. A body-shape parse failure is
 * deterministic and is NOT retried; it propagates immediately.
 */
export async function callOpenRouter(
  request: CompletionRequest,
  apiKey: string
): Promise<CompletionResult> {
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const parsed = await attemptOnce(request, apiKey, controller.signal);
      return {
        content: parsed.content,
        promptTokens: parsed.promptTokens,
        completionTokens: parsed.completionTokens,
        latencyMs: Date.now() - started,
        attempts: attempt,
        reasoningBlocksStripped: parsed.reasoningBlocksStripped,
        finishReason: parsed.finishReason,
      };
    } catch (error) {
      if (error instanceof CompletionParseError) {
        throw error.cause;
      }
      if (error instanceof NonRetryableHttpError) {
        throw error.cause;
      }
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenRouter call failed after retries');
}

/** Tags a deterministic body-shape parse failure so the retry loop can rethrow it immediately instead of retrying. */
class CompletionParseError extends Error {
  constructor(public readonly cause: unknown) {
    super('completion parse failed');
  }
}

/** Tags a non-retryable HTTP status (anything but 429/5xx) so the retry loop rethrows it immediately instead of retrying. */
class NonRetryableHttpError extends Error {
  constructor(public readonly cause: unknown) {
    super('non-retryable HTTP status');
  }
}

/** One HTTP attempt: request + status check + body parse. Throws on ANY failure — a retryable failure (network error, timeout, 429/5xx) throws a plain `Error` the outer loop retries; a non-retryable status or a deterministic body-parse failure throws wrapped in {@link NonRetryableHttpError}/{@link CompletionParseError} so the outer loop rethrows immediately instead of retrying. */
async function attemptOnce(
  request: CompletionRequest,
  apiKey: string,
  signal: AbortSignal
): Promise<ParsedCompletionBody> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/lbds137/tzurot',
      'X-Title': 'tzurot render pilot',
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.jsonMode === true ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const message = `OpenRouter returned ${String(response.status)}: ${bodyText.slice(0, RAW_BODY_PREVIEW_CHARS)}`;
    if (isRetryableStatus(response.status)) {
      throw new Error(message);
    }
    throw new NonRetryableHttpError(new Error(message));
  }

  const bodyText = await response.text();
  try {
    return parseCompletionBody(bodyText);
  } catch (parseError) {
    throw new CompletionParseError(parseError);
  }
}

/** Append one usage record as a JSON line. */
export function appendUsageRecord(usageLogPath: string, record: UsageRecord): void {
  mkdirSync(dirname(usageLogPath), { recursive: true });
  appendFileSync(usageLogPath, `${JSON.stringify(record)}\n`);
}

/**
 * Remove every usage-log line for `stage`, preserving every other stage's
 * lines in order. A no-op when the file is absent. A rerun of one stage
 * (`--stage answers` twice) would otherwise double-count that stage's tokens
 * in the usage table, since the log is append-only — call this once, right
 * after a stage's `shouldRunStage` guard passes and before any model call.
 * A malformed line (fails JSON.parse) is kept rather than dropped — this is
 * a rewrite, not a validator, so an unrelated corruption stays visible
 * rather than silently vanishing.
 */
export function clearStageUsage(usageLogPath: string, stage: string): void {
  if (!existsSync(usageLogPath)) {
    return;
  }
  const lines = readFileSync(usageLogPath, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0);
  const kept = lines.filter(line => {
    try {
      const record = JSON.parse(line) as { stage?: unknown };
      return record.stage !== stage;
    } catch {
      return true;
    }
  });
  writeFileSync(usageLogPath, kept.length === 0 ? '' : `${kept.join('\n')}\n`);
}

/** One task's outcome from {@link runWithConcurrencySettled}: never a rejection. */
export type SettledResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Run `tasks` with at most `concurrency` in flight at once, never rejecting —
 * a single failed call must not sink the whole stage's `Promise.all`. Each
 * task's rejection is caught inside its worker and recorded at that task's
 * own index, so the caller can partition successes from failures afterward.
 */
export async function runWithConcurrencySettled<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<SettledResult<T>[]> {
  const results: SettledResult<T>[] = new Array<SettledResult<T>>(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      try {
        results[index] = { ok: true, value: await tasks[index]() };
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
