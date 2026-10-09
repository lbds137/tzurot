import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETRY_CONFIG, TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';

import {
  hasBudgetForAttempt,
  hopRetryBudgetMs,
  remainingBudgetMs,
  stampLlmDeadline,
} from './llmBudget.js';

/** Total inter-attempt backoff of a full default ladder: MAX_ATTEMPTS-1 delays,
 *  each INITIAL_DELAY_MS × BACKOFF_MULTIPLIER^(retry-1) capped at MAX_DELAY_MS —
 *  the same arithmetic `withRetry` applies between attempts. */
const LADDER_BACKOFF_MS = Array.from({ length: RETRY_CONFIG.MAX_ATTEMPTS - 1 }, (_, i) =>
  Math.min(
    RETRY_CONFIG.INITIAL_DELAY_MS * RETRY_CONFIG.BACKOFF_MULTIPLIER ** i,
    RETRY_CONFIG.MAX_DELAY_MS
  )
).reduce((sum, delay) => sum + delay, 0);

describe('LLM job budget constants', () => {
  it('pins the raised per-attempt and per-hop ceilings', () => {
    expect(TIMEOUTS.LLM_PER_ATTEMPT).toBe(300000);
    expect(TIMEOUTS.LLM_INVOCATION).toBe(910000);
    expect(TIMEOUTS.LLM_JOB_BUDGET).toBe(720000);
  });

  it('full default retry ladder fits inside LLM_INVOCATION', () => {
    const ladder = TIMEOUTS.LLM_PER_ATTEMPT * RETRY_CONFIG.MAX_ATTEMPTS + LADDER_BACKOFF_MS;
    expect(ladder).toBeLessThanOrEqual(TIMEOUTS.LLM_INVOCATION);
  });

  it('worst-case job spend stays under the bot-client flush', () => {
    // The true worst case carries one between-attempts backoff sleep before
    // the overshooting attempt (the gate fires at loop top, after the sleep),
    // so one MAX_DELAY_MS joins budget + overshoot.
    expect(
      TIMEOUTS.LLM_JOB_BUDGET + RETRY_CONFIG.MAX_DELAY_MS + TIMEOUTS.LLM_PER_ATTEMPT
    ).toBeLessThanOrEqual(MULTI_TAG.COORDINATOR_TIMEOUT_MS);
  });
});

describe('stampLlmDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps now + LLM_JOB_BUDGET', () => {
    vi.setSystemTime(1_000_000);
    expect(stampLlmDeadline()).toBe(1_000_000 + TIMEOUTS.LLM_JOB_BUDGET);
  });

  it('accepts an explicit now', () => {
    expect(stampLlmDeadline(50_000)).toBe(50_000 + TIMEOUTS.LLM_JOB_BUDGET);
  });
});

describe('hasBudgetForAttempt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('undefined deadline is a backward-compat no-op (gated open)', () => {
    expect(hasBudgetForAttempt(undefined)).toBe(true);
  });

  it('full fresh budget passes', () => {
    const start = 1_000_000;
    vi.setSystemTime(start);
    expect(hasBudgetForAttempt(stampLlmDeadline())).toBe(true);
  });

  it('remaining budget exactly one attempt passes', () => {
    const start = 1_000_000;
    vi.setSystemTime(start);
    const deadline = stampLlmDeadline();
    vi.setSystemTime(start + TIMEOUTS.LLM_JOB_BUDGET - TIMEOUTS.LLM_PER_ATTEMPT);
    expect(hasBudgetForAttempt(deadline)).toBe(true);
  });

  it('remaining budget just under one attempt fails', () => {
    const start = 1_000_000;
    vi.setSystemTime(start);
    const deadline = stampLlmDeadline();
    vi.setSystemTime(start + TIMEOUTS.LLM_JOB_BUDGET - TIMEOUTS.LLM_PER_ATTEMPT + 1);
    expect(hasBudgetForAttempt(deadline)).toBe(false);
  });

  it('spent budget (deadline in the past) fails', () => {
    vi.setSystemTime(1_000_000);
    expect(hasBudgetForAttempt(500_000)).toBe(false);
  });
});

describe('remainingBudgetMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('undefined deadline reports the full per-hop budget (legacy shape)', () => {
    expect(remainingBudgetMs(undefined)).toBe(TIMEOUTS.LLM_INVOCATION);
  });

  it('reports the remaining budget and floors at 0', () => {
    const start = 1_000_000;
    vi.setSystemTime(start);
    expect(remainingBudgetMs(start + 50_000)).toBe(50_000);
    expect(remainingBudgetMs(start - 1)).toBe(0);
  });
});

describe('hopRetryBudgetMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('undefined deadline keeps the unclamped per-hop budget', () => {
    expect(hopRetryBudgetMs(undefined)).toBe(TIMEOUTS.LLM_INVOCATION);
  });

  it('a fresh deadline clamps to the job budget (below the hop ceiling)', () => {
    const start = 1_000_000;
    vi.setSystemTime(start);
    // LLM_JOB_BUDGET (720s) < LLM_INVOCATION (910s): a freshly stamped job
    // never hands a hop more than the job has left.
    expect(hopRetryBudgetMs(stampLlmDeadline())).toBe(TIMEOUTS.LLM_JOB_BUDGET);
  });

  it('clamps to the remaining budget when it is under the ceiling', () => {
    const start = 1_000_000;
    vi.setSystemTime(start);
    expect(hopRetryBudgetMs(start + 150_000)).toBe(150_000);
  });

  it('a spent budget survives as a 1ms budget (still stops the ladder)', () => {
    vi.setSystemTime(1_000_000);
    expect(hopRetryBudgetMs(500_000)).toBe(1);
  });
});
