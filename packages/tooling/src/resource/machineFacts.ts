/**
 * The live machine's CPU/memory facts in the resolver's input shape.
 *
 * Its own module (no resolver imports) so the root `vitest.config.ts` and
 * spawnEnv.ts share one reader. Memory is the lower of the host total and the
 * process's constrained memory (a cgroup limit), so a container is judged by
 * its limit. A CFS cpu quota (`docker --cpus=N`) is not visible here:
 * `availableParallelism()` follows CPU affinity only.
 */
import * as os from 'node:os';

export interface MachineFacts {
  cpus: number;
  memTotalBytes: number;
}

/**
 * `limit` counts as a real cap only when it is a positive finite number below
 * the host total; 0, undefined, NaN/Infinity and larger values mean "no limit".
 */
export function effectiveMemoryBytes(totalBytes: number, limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0 || limit > totalBytes) {
    return totalBytes;
  }
  return limit;
}

export function liveMachineFacts(): MachineFacts {
  return {
    cpus: os.availableParallelism(),
    memTotalBytes: effectiveMemoryBytes(os.totalmem(), process.constrainedMemory()),
  };
}
