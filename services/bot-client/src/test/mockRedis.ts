/**
 * Shared in-memory Redis fake for dashboard session tests.
 */

import type { Redis, ChainableCommander } from 'ioredis';

interface PipelineOp {
  method: string;
  args: unknown[];
}

interface MockRedis {
  redis: Redis;
  storage: Map<string, string>;
  pipelineOps: PipelineOp[];
}

/**
 * Create a mock Redis client with common operations.
 */
export function createMockRedis(): MockRedis {
  const storage = new Map<string, string>();
  const pipelineOps: PipelineOp[] = [];

  // Use plain functions instead of vi.fn for pipeline to avoid closure issues
  const createPipeline = (): ChainableCommander => {
    // Track ops for this specific pipeline execution
    const localOps: PipelineOp[] = [];

    const pipeline: ChainableCommander = {
      setex(key: string, ttl: number, value: string): ChainableCommander {
        localOps.push({ method: 'setex', args: [key, ttl, value] });
        pipelineOps.push({ method: 'setex', args: [key, ttl, value] });
        return pipeline;
      },
      del(key: string): ChainableCommander {
        localOps.push({ method: 'del', args: [key] });
        pipelineOps.push({ method: 'del', args: [key] });
        return pipeline;
      },
      expire(key: string, ttl: number): ChainableCommander {
        localOps.push({ method: 'expire', args: [key, ttl] });
        pipelineOps.push({ method: 'expire', args: [key, ttl] });
        return pipeline;
      },
      exec(): Promise<[Error | null, unknown][]> {
        // Apply each queued operation to storage in order and return its result tuple
        return Promise.resolve(
          localOps.map((op): [Error | null, unknown] => {
            if (op.method === 'setex') {
              const [key, , value] = op.args as [string, number, string];
              storage.set(key, value);
              return [null, 'OK'];
            }
            if (op.method === 'del') {
              const [key] = op.args as [string];
              return [null, storage.delete(key) ? 1 : 0];
            }
            const [key] = op.args as [string, number];
            return [null, storage.has(key) ? 1 : 0];
          })
        );
      },
    } as unknown as ChainableCommander;
    return pipeline;
  };

  // Use plain functions returning Promises instead of vi.fn to avoid mock complications
  const redis: Redis = {
    get(key: string): Promise<string | null> {
      return Promise.resolve(storage.get(key) ?? null);
    },
    setex(key: string, _ttl: number, value: string): Promise<'OK'> {
      storage.set(key, value);
      return Promise.resolve('OK');
    },
    del(...keys: string[]): Promise<number> {
      let deleted = 0;
      for (const key of keys) {
        if (storage.has(key)) {
          storage.delete(key);
          deleted++;
        }
      }
      return Promise.resolve(deleted);
    },
    expire(key: string, _ttl: number): Promise<number> {
      return Promise.resolve(storage.has(key) ? 1 : 0);
    },
    // mget receives keys as an array
    mget(keys: string[]): Promise<(string | null)[]> {
      return Promise.resolve(keys.map(k => storage.get(k) ?? null));
    },
    // scan receives: cursor, 'MATCH', pattern, 'COUNT', count
    scan(_cursor: string, _match: string, pattern: string): Promise<[string, string[]]> {
      // Convert glob pattern to regex for proper matching
      // 'session:*' should NOT match 'session-msg:*'
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
        .replace(/\*/g, '.*') // Convert glob * to regex .*
        .replace(/\?/g, '.'); // Convert glob ? to regex .
      const regex = new RegExp(`^${regexPattern}$`);

      const matchingKeys: string[] = [];
      for (const key of storage.keys()) {
        if (regex.test(key)) {
          matchingKeys.push(key);
        }
      }
      return Promise.resolve(['0', matchingKeys]); // Return cursor '0' to indicate scan complete
    },
    pipeline(): ChainableCommander {
      pipelineOps.length = 0; // Reset pipeline ops for this pipeline
      return createPipeline();
    },
  } as unknown as Redis;

  return { redis, storage, pipelineOps };
}
