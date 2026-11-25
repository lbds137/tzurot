/**
 * Concurrency-bounded map.
 *
 * Runs `fn` over `items` with at most `limit` calls in flight, resolving to the
 * results in INPUT order. Rejects with the first rejection, like `Promise.all`; unlike
 * it, unstarted items are skipped, and in-flight items run to completion unobserved.
 */

/**
 * Map `items` through `fn` with at most `limit` calls in flight at once.
 *
 * @throws {RangeError} synchronously when `limit` is below 1 or not a number.
 */
export function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!(limit >= 1)) {
    throw new RangeError(`mapWithConcurrency: limit must be at least 1 (got ${limit})`);
  }

  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  // A fixed pool of runners, each pulling the next unclaimed index until the list is
  // exhausted or a sibling has failed.
  const runner = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const runnerCount = Math.min(Math.floor(limit), items.length);
  const runners = Array.from({ length: runnerCount }, () => runner());
  return Promise.all(runners).then(() => results);
}
