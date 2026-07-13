import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERVALS } from '../constants/timing.js';
import { SYSTEM_SETTINGS_FALLBACKS } from '../schemas/api/systemSettings.js';
import {
  SystemSettingsService,
  registerSystemSettings,
  getSystemSetting,
  resetSystemSettingsRegistration,
} from './SystemSettingsService.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const mockFindUnique = vi.fn();
const prisma = {
  adminSettings: { findUnique: mockFindUnique },
} as unknown as PrismaClient;

function rowWith(bag: unknown): { systemSettings: unknown } {
  return { systemSettings: bag };
}

/** Flush pending microtasks under fake timers (lets a kicked refresh land). */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('SystemSettingsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue(rowWith({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('get() sync contract', () => {
    it('serves the fallback constant before any load, without throwing', () => {
      const service = new SystemSettingsService(prisma);
      expect(service.get('zaiHeadroomPercent')).toBe(SYSTEM_SETTINGS_FALLBACKS.zaiHeadroomPercent);
      expect(service.get('extractionEnabled')).toBe(false);
    });

    it('serves DB values after prime()', async () => {
      mockFindUnique.mockResolvedValue(rowWith({ zaiHeadroomPercent: 42 }));
      const service = new SystemSettingsService(prisma);
      await service.prime();
      expect(service.get('zaiHeadroomPercent')).toBe(42);
      expect(service.isLoaded()).toBe(true);
    });

    it('never throws even when the DB read rejects', async () => {
      mockFindUnique.mockRejectedValue(new Error('connection refused'));
      const service = new SystemSettingsService(prisma);
      expect(() => service.get('fallbackTextModel')).not.toThrow();
      await flush();
      expect(service.get('fallbackTextModel')).toBe(SYSTEM_SETTINGS_FALLBACKS.fallbackTextModel);
    });
  });

  describe('stale-while-revalidate', () => {
    it('serves the stale value while the background refresh runs', async () => {
      mockFindUnique.mockResolvedValue(rowWith({ zaiHeadroomPercent: 42 }));
      const service = new SystemSettingsService(prisma);
      await service.prime();

      // Make the next refresh slow and change the value it returns.
      let release: (() => void) | undefined;
      mockFindUnique.mockImplementation(
        () =>
          new Promise(resolve => {
            release = () => resolve(rowWith({ zaiHeadroomPercent: 55 }));
          })
      );
      await vi.advanceTimersByTimeAsync(INTERVALS.API_KEY_CACHE_TTL + 1);

      // Stale read: kicks the refresh but serves the old value synchronously.
      expect(service.get('zaiHeadroomPercent')).toBe(42);
      expect(release).toBeDefined();
      release?.();
      await flush();
      expect(service.get('zaiHeadroomPercent')).toBe(55);
    });

    it('single-flights concurrent stale reads (one DB call)', async () => {
      const service = new SystemSettingsService(prisma);
      await service.prime();
      mockFindUnique.mockClear();

      await vi.advanceTimersByTimeAsync(INTERVALS.API_KEY_CACHE_TTL + 1);
      service.get('extractionEnabled');
      service.get('zaiHeadroomPercent');
      service.get('fallbackTextModel');
      await flush();
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
    });

    it('does not re-query within the TTL window', async () => {
      const service = new SystemSettingsService(prisma);
      await service.prime();
      mockFindUnique.mockClear();

      service.get('extractionEnabled');
      await flush();
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('keeps last-known values across a failed refresh, retrying on the TTL cadence', async () => {
      mockFindUnique.mockResolvedValue(rowWith({ zaiHeadroomPercent: 42 }));
      const service = new SystemSettingsService(prisma);
      await service.prime();

      mockFindUnique.mockRejectedValue(new Error('db down'));
      await vi.advanceTimersByTimeAsync(INTERVALS.API_KEY_CACHE_TTL + 1);
      service.get('zaiHeadroomPercent');
      await flush();
      // Failure: last-known survives.
      expect(service.get('zaiHeadroomPercent')).toBe(42);

      mockFindUnique.mockClear();
      // Within the fresh TTL window after the failed attempt: no hot-loop retry.
      service.get('zaiHeadroomPercent');
      await flush();
      expect(mockFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('invalidate()', () => {
    it('kicks an immediate refresh and serves the new value once landed', async () => {
      mockFindUnique.mockResolvedValue(rowWith({ extractionEnabled: false }));
      const service = new SystemSettingsService(prisma);
      await service.prime();

      mockFindUnique.mockResolvedValue(rowWith({ extractionEnabled: true }));
      service.invalidate();
      await flush();
      expect(service.get('extractionEnabled')).toBe(true);
    });
  });

  describe('per-key validation', () => {
    it('drops an invalid key (fallback served) while keeping valid siblings', async () => {
      mockFindUnique.mockResolvedValue(
        rowWith({ zaiHeadroomPercent: 'not-a-number', extractionEnabled: true })
      );
      const service = new SystemSettingsService(prisma);
      await service.prime();
      expect(service.get('zaiHeadroomPercent')).toBe(SYSTEM_SETTINGS_FALLBACKS.zaiHeadroomPercent);
      expect(service.get('extractionEnabled')).toBe(true);
    });

    it('ignores unknown keys on read (write path owns preservation)', async () => {
      mockFindUnique.mockResolvedValue(rowWith({ futureKey: 'x', zaiHeadroomPercent: 30 }));
      const service = new SystemSettingsService(prisma);
      await service.prime();
      expect(service.get('zaiHeadroomPercent')).toBe(30);
    });

    it('serves all fallbacks when the column is null or malformed', async () => {
      mockFindUnique.mockResolvedValue(rowWith(null));
      const service = new SystemSettingsService(prisma);
      await service.prime();
      expect(service.get('freeTierMaxPerWindow')).toBe(
        SYSTEM_SETTINGS_FALLBACKS.freeTierMaxPerWindow
      );

      mockFindUnique.mockResolvedValue(rowWith(['not', 'an', 'object']));
      service.invalidate();
      await flush();
      expect(service.get('freeTierMaxPerWindow')).toBe(
        SYSTEM_SETTINGS_FALLBACKS.freeTierMaxPerWindow
      );
    });

    it('serves fallbacks when the singleton row does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);
      const service = new SystemSettingsService(prisma);
      await service.prime();
      expect(service.get('fallbackVisionModelFree')).toBe(
        SYSTEM_SETTINGS_FALLBACKS.fallbackVisionModelFree
      );
    });
  });
});

describe('ambient accessor (registerSystemSettings / getSystemSetting)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFindUnique.mockReset();
    resetSystemSettingsRegistration();
  });

  afterEach(() => {
    resetSystemSettingsRegistration();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('serves registry fallbacks before any instance is registered (boot-order tolerance)', () => {
    expect(getSystemSetting('extractionBatchThreshold')).toBe(
      SYSTEM_SETTINGS_FALLBACKS.extractionBatchThreshold
    );
    expect(getSystemSetting('extractionEnabled')).toBe(SYSTEM_SETTINGS_FALLBACKS.extractionEnabled);
  });

  it('reads through the registered instance after registration', async () => {
    mockFindUnique.mockResolvedValue(rowWith({ extractionBatchThreshold: 42 }));
    const service = new SystemSettingsService(prisma);
    await service.prime();
    registerSystemSettings(service);

    expect(getSystemSetting('extractionBatchThreshold')).toBe(42);
  });

  it('a later registration replaces the earlier one (per-process singleton semantics)', async () => {
    mockFindUnique.mockResolvedValue(rowWith({ extractionBatchThreshold: 7 }));
    const first = new SystemSettingsService(prisma);
    await first.prime();
    registerSystemSettings(first);

    mockFindUnique.mockResolvedValue(rowWith({ extractionBatchThreshold: 9 }));
    const second = new SystemSettingsService(prisma);
    await second.prime();
    registerSystemSettings(second);

    expect(getSystemSetting('extractionBatchThreshold')).toBe(9);
  });
});
