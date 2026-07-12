/**
 * Deterministic bucket-based even-spacing sampler, shared by the goldens miners.
 *
 * Both `mine-goldens` (memory corpus) and `mine-conversation-goldens` (query
 * turns) need the same primitive: pick `quota` items spread evenly across a
 * chronologically-sorted pool so old and recent both survive. Kept in one place
 * so the two miners can't drift.
 */

/**
 * Pick `quota` items spread evenly across `buckets` equal-count buckets of a
 * (caller-)sorted pool. Earlier buckets absorb the remainder; within a bucket,
 * picks are evenly spaced. No RNG — the same pool always yields the same sample.
 */
export function pickEvenlySpaced<T>(sortedPool: T[], quota: number, buckets: number): T[] {
  if (quota <= 0 || sortedPool.length === 0) {
    return [];
  }
  const target = Math.min(quota, sortedPool.length);
  const bucketSize = Math.ceil(sortedPool.length / buckets);
  const bucketList: T[][] = [];
  for (let start = 0; start < sortedPool.length; start += bucketSize) {
    bucketList.push(sortedPool.slice(start, start + bucketSize));
  }
  const perBucketBase = Math.floor(target / bucketList.length);
  let remainder = target - perBucketBase * bucketList.length;
  const picked: T[] = [];
  for (const bucket of bucketList) {
    let take = perBucketBase;
    if (remainder > 0) {
      take += 1;
      remainder -= 1;
    }
    take = Math.min(take, bucket.length);
    for (let i = 0; i < take; i++) {
      picked.push(bucket[Math.floor((i * bucket.length) / take)]);
    }
  }
  return picked.slice(0, target);
}
