/**
 * Tests for the count-cap hysteresis arithmetic.
 *
 * The properties matter more than any single case: the whole design rests on
 * the window START being fixed while messages accumulate, so the tests sweep
 * n and cap rather than pinning a handful of examples.
 */

import { describe, it, expect } from 'vitest';
import { HISTORY_WINDOW, resolveEvictionChunk, resolveHistoryWindow } from './historyWindow.js';

describe('resolveEvictionChunk', () => {
  it('is 0 below the hysteresis cap threshold', () => {
    for (let cap = 0; cap < HISTORY_WINDOW.MIN_CAP_FOR_HYSTERESIS; cap++) {
      expect(resolveEvictionChunk(cap)).toBe(0);
    }
  });

  it('is 0 at exactly the floor — there is no room to quantize', () => {
    // cap - MIN_MESSAGE_FLOOR === 0, so hysteresis starts one message higher.
    expect(resolveEvictionChunk(HISTORY_WINDOW.MIN_MESSAGE_FLOOR)).toBe(0);
    expect(resolveEvictionChunk(HISTORY_WINDOW.MIN_MESSAGE_FLOOR + 1)).toBe(1);
  });

  it('is the configured ratio of the cap once clear of the floor', () => {
    // 0.25 * 50 = 12.5 -> 13, and 50 - 20 = 30 does not bind.
    expect(resolveEvictionChunk(50)).toBe(13);
    expect(resolveEvictionChunk(100)).toBe(25);
  });

  it('never lets the window fall below the floor', () => {
    for (let cap = 1; cap <= 200; cap++) {
      const chunk = resolveEvictionChunk(cap);
      if (chunk > 0) {
        expect(cap - chunk).toBeGreaterThanOrEqual(HISTORY_WINDOW.MIN_MESSAGE_FLOOR);
      }
    }
  });
});

describe('resolveHistoryWindow', () => {
  it('never slides while the window is unfull', () => {
    const cap = 50;
    for (let n = 0; n <= cap; n++) {
      const w = resolveHistoryWindow(n, cap);
      expect(w.evicted).toBe(0);
      expect(w.take).toBe(n);
    }
  });

  it('keeps take within (cap - chunk, cap] once full', () => {
    for (let cap = 1; cap <= 100; cap++) {
      const chunk = resolveEvictionChunk(cap);
      for (let n = cap; n <= cap + 137; n++) {
        const w = resolveHistoryWindow(n, cap);
        expect(w.take).toBeLessThanOrEqual(cap);
        if (chunk > 0) {
          expect(w.take).toBeGreaterThan(cap - chunk);
        }
      }
    }
  });

  it('holds the window START fixed across a whole chunk of new messages', () => {
    // The head is the (evicted + 1)-th oldest row. This is THE property the
    // design exists to produce: it must not move as n grows within a chunk.
    const cap = 50;
    const chunk = resolveEvictionChunk(cap);
    const startFor = (n: number): number => resolveHistoryWindow(n, cap).evicted;

    const base = startFor(cap + 1);
    for (let step = 1; step < chunk; step++) {
      expect(startFor(cap + 1 + step)).toBe(base);
    }
    // ...and jumps exactly once, by exactly one chunk, at the boundary.
    expect(startFor(cap + 1 + chunk)).toBe(base + chunk);
  });

  it('takes exactly the cap at every slide boundary', () => {
    const cap = 50;
    const chunk = resolveEvictionChunk(cap);
    // n = cap + k*chunk is the point where eviction exactly absorbs the excess.
    for (let k = 0; k <= 5; k++) {
      expect(resolveHistoryWindow(cap + k * chunk, cap).take).toBe(cap);
    }
  });

  it('evicts a whole number of chunks, always', () => {
    for (let cap = 21; cap <= 100; cap += 7) {
      const chunk = resolveEvictionChunk(cap);
      for (let n = cap; n <= cap + 200; n += 3) {
        const w = resolveHistoryWindow(n, cap);
        expect(w.evicted % chunk).toBe(0);
      }
    }
  });

  // Looks tautological against `take = n - evicted`, and a review flagged it as
  // such — but it is the ONLY test here that fires when the REPORTED `evicted`
  // disagrees with the one used to compute `take`. Mutating the return to
  // `{ evicted: evicted + chunk, take: n - evicted }` turns this test red and
  // leaves the other 13 green. That is the telemetry-diverges-from-behavior
  // class, which this PR shipped twice before review caught it, so the guard
  // stays.
  it('conserves rows: evicted + take always equals the in-scope count once full', () => {
    for (let cap = 21; cap <= 100; cap += 11) {
      for (let n = cap; n <= cap + 200; n += 5) {
        const w = resolveHistoryWindow(n, cap);
        expect(w.evicted + w.take).toBe(n);
      }
    }
  });

  it('tracks the row count exactly when hysteresis is off (small cap)', () => {
    const cap = 10; // below MIN_CAP_FOR_HYSTERESIS
    expect(resolveEvictionChunk(cap)).toBe(0);
    for (let n = 0; n <= 40; n++) {
      const w = resolveHistoryWindow(n, cap);
      expect(w.chunk).toBe(0);
      expect(w.evicted).toBe(0);
      expect(w.take).toBe(Math.min(n, cap));
    }
  });

  it('does not divide by zero at the floor cap', () => {
    // Regression guard: chunk is 0 at cap === floor, and the quantization
    // formula divides by chunk.
    const w = resolveHistoryWindow(500, HISTORY_WINDOW.MIN_MESSAGE_FLOOR);
    expect(w.take).toBe(HISTORY_WINDOW.MIN_MESSAGE_FLOOR);
    expect(Number.isFinite(w.evicted)).toBe(true);
    expect(w.evicted).toBe(0);
  });

  it('treats a negative or zero cap as empty rather than producing junk', () => {
    for (const cap of [-10, -1, 0]) {
      const w = resolveHistoryWindow(100, cap);
      expect(w.take).toBe(0);
      expect(w.evicted).toBe(0);
    }
  });

  it('never returns a negative take', () => {
    for (let cap = 0; cap <= 120; cap += 3) {
      for (let n = 0; n <= 300; n += 7) {
        expect(resolveHistoryWindow(n, cap).take).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('treats exactly-at-cap as unfull with hysteresis on', () => {
    // The clamp's equality edge: inScopeCount === effectiveCap takes the
    // unfull branch, not eviction; the chunk in force is still reported.
    const w50 = resolveHistoryWindow(50, 50);
    expect(w50.evicted).toBe(0);
    expect(w50.take).toBe(50);
    expect(w50.chunk).toBe(13);
    const w21 = resolveHistoryWindow(21, 21);
    expect(w21.evicted).toBe(0);
    expect(w21.take).toBe(21);
    expect(w21.chunk).toBe(1);
  });

  it('the <= at the clamp boundary is equivalent to < (pins the Stryker exclusion)', () => {
    // This test is the mechanical pin behind the Stryker disable in
    // historyWindow.ts: the inline copy below flips <= to < and must stay
    // behavior-identical to the real function. If it reddens, the two have
    // diverged - either the eviction arithmetic changed (update the copy,
    // then re-derive the equivalence) or the boundary became observable
    // (remove the disable and kill the mutant with a test instead).
    const mutantResolve = (inScopeCount: number, cap: number) => {
      const effectiveCap = Math.max(0, cap);
      // Local copy of resolveEvictionChunk.
      let chunk = 0;
      if (effectiveCap >= HISTORY_WINDOW.MIN_CAP_FOR_HYSTERESIS) {
        chunk = Math.min(
          Math.ceil(HISTORY_WINDOW.EVICTION_CHUNK_RATIO * effectiveCap),
          effectiveCap - HISTORY_WINDOW.MIN_MESSAGE_FLOOR
        );
        chunk = chunk > 0 ? chunk : 0;
      }
      // The flip under test: <= became <.
      if (inScopeCount < effectiveCap || chunk === 0) {
        return { evicted: 0, take: Math.min(inScopeCount, effectiveCap), chunk };
      }
      const evicted = chunk * Math.ceil((inScopeCount - effectiveCap) / chunk);
      return { evicted, take: inScopeCount - evicted, chunk };
    };

    for (let n = 0; n <= 120; n++) {
      for (let cap = 0; cap <= 120; cap++) {
        const real = resolveHistoryWindow(n, cap);
        const mutant = mutantResolve(n, cap);
        expect(mutant.evicted).toBe(real.evicted);
        expect(mutant.take).toBe(real.take);
        expect(mutant.chunk).toBe(real.chunk);
      }
    }
  });
});
