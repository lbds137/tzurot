import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetex = vi.fn();
const mockGet = vi.fn();
vi.mock('../../redis.js', () => ({
  redis: {
    setex: (...args: unknown[]) => mockSetex(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import {
  storeDbSyncReport,
  fetchDbSyncReport,
  DB_SYNC_REPORT_TTL_SECONDS,
} from './dbSyncReportStore.js';

describe('dbSyncReportStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetex.mockResolvedValue('OK');
    mockGet.mockResolvedValue(null);
  });

  it('stores under a prefixed key with the TTL and returns the bare key', async () => {
    const key = await storeDbSyncReport('# Report');

    expect(key).toBeTruthy();
    expect(mockSetex).toHaveBeenCalledWith(
      `dbsync:report:${key}`,
      DB_SYNC_REPORT_TTL_SECONDS,
      '# Report'
    );
  });

  it('returns null when the store write fails (caller falls back to inline)', async () => {
    mockSetex.mockRejectedValue(new Error('redis down'));

    expect(await storeDbSyncReport('# Report')).toBeNull();
  });

  it('round-trips a fetch by key', async () => {
    mockGet.mockResolvedValue('# Report');

    expect(await fetchDbSyncReport('abc')).toBe('# Report');
    expect(mockGet).toHaveBeenCalledWith('dbsync:report:abc');
  });

  it('returns null on fetch failure or expiry', async () => {
    mockGet.mockRejectedValue(new Error('redis down'));
    expect(await fetchDbSyncReport('abc')).toBeNull();

    mockGet.mockReset().mockResolvedValue(null);
    expect(await fetchDbSyncReport('gone')).toBeNull();
  });
});
