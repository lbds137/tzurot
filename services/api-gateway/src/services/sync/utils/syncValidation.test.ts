/**
 * Unit tests for the schema-version gate — the throw-on-mismatch default and
 * the allow-schema-skew soak-window override are both safety-critical branches.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkSchemaVersions } from './syncValidation.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const clientAt = (migration: string) =>
  ({
    $queryRaw: vi.fn().mockResolvedValue([{ migration_name: migration }]),
  }) as unknown as PrismaClient;

describe('checkSchemaVersions', () => {
  it('returns the shared version when both sides match', async () => {
    const version = await checkSchemaVersions(clientAt('20260701_a'), clientAt('20260701_a'));
    expect(version).toBe('20260701_a');
  });

  it('throws on mismatch by default (the protective branch)', async () => {
    await expect(
      checkSchemaVersions(clientAt('20260705_new'), clientAt('20260701_a'))
    ).rejects.toThrow('Schema version mismatch');
  });

  it('proceeds with a skew-labeled version under allowSkew (soak-window override)', async () => {
    const version = await checkSchemaVersions(
      clientAt('20260705_new'),
      clientAt('20260701_a'),
      true
    );
    expect(version).toContain('20260705_new');
    expect(version).toContain('skew allowed');
  });

  it('still throws when a version cannot be determined, even under allowSkew', async () => {
    const empty = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    await expect(checkSchemaVersions(empty, clientAt('20260701_a'), true)).rejects.toThrow(
      'Could not determine schema versions'
    );
  });
});
