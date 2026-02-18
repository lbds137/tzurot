/**
 * Tests for environment-aware Prisma client factory
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies — both are used as constructors (`new X(...)`)
vi.mock('@tzurot/common-types', () => ({
  PrismaClient: class MockPrismaClient {
    $disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class MockPrismaPg {},
}));

vi.mock('../utils/env-runner.js', () => ({
  getRailwayDatabaseUrl: vi.fn().mockReturnValue('postgresql://railway:pass@host:5432/db'),
}));

import { getPrismaForEnv } from './prisma-env.js';
import { getRailwayDatabaseUrl } from '../utils/env-runner.js';

describe('prisma-env', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPrismaForEnv', () => {
    it('should use DATABASE_URL for local environment', async () => {
      const original = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://local:pass@localhost:5432/test';

      try {
        const { prisma, disconnect } = await getPrismaForEnv('local');
        expect(prisma).toBeDefined();
        expect(disconnect).toBeInstanceOf(Function);
        expect(getRailwayDatabaseUrl).not.toHaveBeenCalled();
      } finally {
        if (original !== undefined) {
          process.env.DATABASE_URL = original;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    it('should throw if DATABASE_URL not set for local', async () => {
      const original = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        await expect(getPrismaForEnv('local')).rejects.toThrow(
          'DATABASE_URL not set for local environment'
        );
      } finally {
        if (original !== undefined) {
          process.env.DATABASE_URL = original;
        }
      }
    });

    it('should use getRailwayDatabaseUrl for dev environment', async () => {
      const { prisma, disconnect } = await getPrismaForEnv('dev');
      expect(prisma).toBeDefined();
      expect(disconnect).toBeInstanceOf(Function);
      expect(getRailwayDatabaseUrl).toHaveBeenCalledWith('dev');
    });

    it('should use getRailwayDatabaseUrl for prod environment', async () => {
      const { prisma, disconnect } = await getPrismaForEnv('prod');
      expect(prisma).toBeDefined();
      expect(disconnect).toBeInstanceOf(Function);
      expect(getRailwayDatabaseUrl).toHaveBeenCalledWith('prod');
    });

    it('should return a disconnect function that calls $disconnect', async () => {
      const { prisma, disconnect } = await getPrismaForEnv('dev');
      await disconnect();
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
