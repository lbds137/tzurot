/**
 * Service Test: SystemSettingsService
 *
 * Exercises the REAL database read path (PGlite in-memory Postgres): the
 * singleton-row read, per-key validation over a real JSONB column, and the
 * fallback behavior for absent rows/keys. The SWR cache mechanics (staleness,
 * single-flight, failure retention) are covered by the colocated unit test —
 * this tier proves the plumbing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
import { PrismaClient } from '../generated/prisma/client.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '../schemas/api/adminSettings.js';
import { SYSTEM_SETTINGS_FALLBACKS } from '../schemas/api/systemSettings.js';
import { SystemSettingsService } from './SystemSettingsService.js';

describe('SystemSettingsService (component)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    await prisma.adminSettings.deleteMany();
  });

  it('serves fallbacks when the singleton row does not exist', async () => {
    const service = new SystemSettingsService(prisma);
    await service.prime();

    expect(service.get('zaiHeadroomPercent')).toBe(SYSTEM_SETTINGS_FALLBACKS.zaiHeadroomPercent);
    expect(service.get('fallbackTextModelFree')).toBe(
      SYSTEM_SETTINGS_FALLBACKS.fallbackTextModelFree
    );
    expect(service.isLoaded()).toBe(true);
  });

  it('reads stored values from a real JSONB bag, falling back per absent key', async () => {
    await prisma.adminSettings.create({
      data: {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        systemSettings: { zaiHeadroomPercent: 42, extractionEnabled: true },
      },
    });
    const service = new SystemSettingsService(prisma);
    await service.prime();

    expect(service.get('zaiHeadroomPercent')).toBe(42);
    expect(service.get('extractionEnabled')).toBe(true);
    // Key absent from the stored bag → registry fallback.
    expect(service.get('freeTierMaxPerWindow')).toBe(
      SYSTEM_SETTINGS_FALLBACKS.freeTierMaxPerWindow
    );
  });

  it('drops a type-corrupted key while keeping valid siblings (real column round-trip)', async () => {
    await prisma.adminSettings.create({
      data: {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        systemSettings: { zaiHeadroomPercent: 'ninety', freeTierMinPerWindow: 7 },
      },
    });
    const service = new SystemSettingsService(prisma);
    await service.prime();

    expect(service.get('zaiHeadroomPercent')).toBe(SYSTEM_SETTINGS_FALLBACKS.zaiHeadroomPercent);
    expect(service.get('freeTierMinPerWindow')).toBe(7);
  });

  it('picks up a row update on the next refresh', async () => {
    await prisma.adminSettings.create({
      data: {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        systemSettings: { extractionEnabled: false },
      },
    });
    const service = new SystemSettingsService(prisma);
    await service.prime();
    expect(service.get('extractionEnabled')).toBe(false);

    await prisma.adminSettings.update({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      data: { systemSettings: { extractionEnabled: true } },
    });
    await service.prime();

    expect(service.get('extractionEnabled')).toBe(true);
  });
});
