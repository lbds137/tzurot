import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency } from './mapWithConcurrency.js';

/** Let queued promise continuations run. No timers involved. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe('mapWithConcurrency', () => {
  it('resolves an empty array to an empty array without calling fn', async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 3, () => {
      calls += 1;
      return Promise.resolve(0);
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('keeps at most `limit` calls in flight and returns results in input order', async () => {
    const release: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = (item: number): Promise<number> =>
      new Promise<number>(resolve => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        release.push(() => {
          inFlight -= 1;
          resolve(item * 10);
        });
      });

    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const promise = mapWithConcurrency(items, 3, fn);

    await flush();
    expect(inFlight).toBe(3);

    // Complete calls in reverse start order so completion order differs from input order.
    while (release.length > 0) {
      release.pop()?.();
      await flush();
    }

    expect(await promise).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(maxInFlight).toBe(3);
  });

  it('returns every result in input order when limit exceeds the item count', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await mapWithConcurrency([1, 2], 10, async item => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return item;
    });
    expect(result).toEqual([1, 2]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('passes the item and its index to fn', async () => {
    const seen: Array<[string, number]> = [];
    await mapWithConcurrency(['a', 'b'], 1, async (item, index) => {
      seen.push([item, index]);
      return item;
    });
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('rejects the whole call when fn rejects, and starts no later items', async () => {
    const started: number[] = [];
    const promise = mapWithConcurrency([1, 2, 3, 4], 1, async item => {
      started.push(item);
      if (item === 2) {
        throw new Error('boom');
      }
      return item;
    });
    await expect(promise).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });

  it('floors a fractional limit: 2.5 keeps at most 2 calls in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];
    const promise = mapWithConcurrency([1, 2, 3, 4, 5], 2.5, item => {
      return new Promise<number>(resolve => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        release.push(() => {
          inFlight--;
          resolve(item);
        });
      });
    });

    await flush();
    expect(release).toHaveLength(2);

    while (release.length > 0) {
      release.shift()?.();
      await flush();
    }

    expect(await promise).toEqual([1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(2);
  });

  it('rejects when one of several in-flight items rejects, with no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const started: number[] = [];
      const settlers = new Map<number, { reject: (error: unknown) => void }>();
      const promise = mapWithConcurrency([1, 2, 3], 2, (item: number) => {
        started.push(item);
        return new Promise<number>((_resolve, reject) => {
          settlers.set(item, { reject });
        });
      });
      // Attach the rejection assertion before anything rejects so the outcome is observed.
      const assertion = expect(promise).rejects.toThrow('one');

      await flush();
      expect(started).toEqual([1, 2]);

      settlers.get(1)?.reject(new Error('one'));
      await flush();
      settlers.get(2)?.reject(new Error('two'));
      await flush();
      // Let Node's unhandled-rejection tracker run before asserting it stayed silent.
      await new Promise<void>(resolve => setImmediate(resolve));

      await assertion;
      expect(started).toEqual([1, 2]);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('throws a RangeError for a limit below 1', () => {
    expect(() => mapWithConcurrency([1], 0, async item => item)).toThrow(RangeError);
    expect(() => mapWithConcurrency([1], -1, async item => item)).toThrow(RangeError);
    expect(() => mapWithConcurrency([1], Number.NaN, async item => item)).toThrow(RangeError);
  });
});
