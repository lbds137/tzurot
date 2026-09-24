/**
 * Component test: db-sync single-flight guard over the REAL mounted gateway
 * surface (conformance harness: generated mounts, real admin auth, PGLite,
 * real ioredis test-DB client). `DatabaseSyncService` is mocked — the
 * guard's behavior (this test's seam) is orthogonal to the real sync's DB
 * work, which `dbSync.test.ts` already covers.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { DB_SYNC_SINGLE_FLIGHT_KEY } from '../../services/sync/dbSyncSingleFlight.js';

const mockSync = vi.fn();
vi.mock('../../services/DatabaseSyncService.js', () => ({
  DatabaseSyncService: class {
    sync = mockSync;
  },
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      DEV_DATABASE_URL: 'postgresql://dev-url',
      PROD_DATABASE_URL: 'postgresql://prod-url',
    }),
  };
});

import {
  buildConformanceHarness,
  authHeaders,
  type ConformanceHarness,
} from '../conformance/fixtures/harness.js';

const SYNC_RESULT = {
  schemaVersion: 'v1',
  stats: {},
  warnings: [],
  info: [],
  deletions: [],
  deletionsTruncated: false,
};

describe('db-sync single-flight guard (component, real mounts over PGLite)', () => {
  let harness: ConformanceHarness;

  beforeAll(async () => {
    harness = await buildConformanceHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  async function sync() {
    return request(harness.app)
      .post('/api/admin/db-sync')
      .set(authHeaders())
      .send({ dryRun: false });
  }

  it('refuses a concurrent request with 409 while the first is pending, releasing the guard on success', async () => {
    let resolveSync: (value: unknown) => void = () => {
      /* replaced below */
    };
    const pending = new Promise(resolve => {
      resolveSync = resolve;
    });
    mockSync.mockReturnValueOnce(pending);

    let firstStatus = -1;
    // supertest's Test is lazy — `.then()` is what fires the request.
    const firstRequest = sync().then(res => {
      firstStatus = res.status;
    });

    await vi.waitFor(() => {
      if (mockSync.mock.calls.length === 0) {
        throw new Error('first request has not reached mockSync yet');
      }
    });

    const secondResponse = await sync();

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.code).toBe('DB_SYNC_IN_PROGRESS');

    resolveSync(SYNC_RESULT);
    await firstRequest;
    expect(firstStatus).toBe(200);

    // The client sees the response before the server's own `finally`
    // release necessarily completes — poll rather than a single read.
    await vi.waitFor(async () => {
      const stored = await harness.deps.redis?.get(DB_SYNC_SINGLE_FLIGHT_KEY);
      if (stored !== null) {
        throw new Error('guard not yet released');
      }
    });
  });

  it('releases the guard when sync throws — a next request reaches sync again', async () => {
    mockSync.mockReset();
    mockSync.mockRejectedValueOnce(new Error('boom'));

    const first = await sync();
    expect(first.status).toBe(500);

    await vi.waitFor(async () => {
      const stored = await harness.deps.redis?.get(DB_SYNC_SINGLE_FLIGHT_KEY);
      if (stored !== null) {
        throw new Error('guard not yet released');
      }
    });
    mockSync.mockResolvedValueOnce(SYNC_RESULT);
    const second = await sync();
    expect(second.status).toBe(200);
    expect(mockSync).toHaveBeenCalledTimes(2);
  });
});
