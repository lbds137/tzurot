import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  SystemSettingsSchema,
  buildSystemSettingsSeed,
} from '@tzurot/common-types/schemas/api/systemSettings';
import { createTestConfig } from '@tzurot/common-types/config/config';
import { seedSystemSettingsIfUnset } from './systemSettingsSeed.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return {
    ...actual,
    getConfig: () => actual.createTestConfig({ EXTRACTION_BATCH_THRESHOLD: 9 }),
  };
});

const mockExecuteRaw = vi.fn();
const prisma = { $executeRaw: mockExecuteRaw } as unknown as PrismaClient;

/** Reassemble the tagged-template call into { sql, values } for assertions. */
function capturedCall(): { sql: string; values: unknown[] } {
  const call = mockExecuteRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return { sql: call[0].join('?'), values: call.slice(1) };
}

describe('seedSystemSettingsIfUnset', () => {
  beforeEach(() => {
    mockExecuteRaw.mockReset();
    mockExecuteRaw.mockResolvedValue(1);
  });

  it('runs one atomic upsert against the singleton row', async () => {
    await seedSystemSettingsIfUnset(prisma);

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = capturedCall();
    expect(sql).toContain('INSERT INTO admin_settings');
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
    expect(values[0]).toBe(ADMIN_SETTINGS_SINGLETON_ID);
  });

  it('puts the seed LEFT of the merge so existing keys win (insert-if-absent)', async () => {
    await seedSystemSettingsIfUnset(prisma);

    const { sql } = capturedCall();
    // `seed || existing`: the existing bag is the RIGHT operand of the JSONB
    // concatenation, so an admin's explicit value overrides the seed.
    expect(sql).toMatch(
      /SET system_settings = \?::jsonb \|\| COALESCE\(admin_settings\.system_settings, '\{\}'::jsonb\)/
    );
  });

  it('seeds the full registry bag, valid against the resolved schema', async () => {
    await seedSystemSettingsIfUnset(prisma);

    const { values } = capturedCall();
    const seedJson = values.find(
      (value): value is string => typeof value === 'string' && value.startsWith('{')
    );
    expect(seedJson).toBeDefined();
    const bag: unknown = JSON.parse(seedJson as string);
    expect(() => SystemSettingsSchema.parse(bag)).not.toThrow();
    // Env-derived seed values flow through (the mocked env sets threshold 9).
    expect(bag).toMatchObject(
      buildSystemSettingsSeed(createTestConfig({ EXTRACTION_BATCH_THRESHOLD: 9 }))
    );
  });

  it('swallows DB errors (readers fall back to in-code constants)', async () => {
    mockExecuteRaw.mockRejectedValue(new Error('db down'));

    await expect(seedSystemSettingsIfUnset(prisma)).resolves.toBeUndefined();
  });
});
