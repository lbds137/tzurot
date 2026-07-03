/**
 * Environment-aware Prisma client factory
 *
 * Creates a PrismaClient with PrismaPg driver adapter configured
 * for the specified environment (local, dev, or prod).
 * Shared by memory CLI scripts.
 */

import { type Environment, getRailwayDatabaseUrl } from '../utils/env-runner.js';
import { transientPoolOptions } from '@tzurot/common-types/services/poolConfig';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

export interface PrismaEnvConnection {
  prisma: PrismaClient;
  disconnect: () => Promise<void>;
}

/**
 * Get Prisma client configured for the specified environment.
 *
 * Dynamically imports Prisma to avoid loading it until needed.
 */
export async function getPrismaForEnv(env: Environment): Promise<PrismaEnvConnection> {
  const { PrismaClient: PrismaClientClass } = await import('@tzurot/common-types/services/prisma');
  const { PrismaPg } = await import('@prisma/adapter-pg');

  let databaseUrl: string;
  if (env === 'local') {
    databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) {
      throw new Error('DATABASE_URL not set for local environment');
    }
  } else {
    databaseUrl = getRailwayDatabaseUrl(env);
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl, ...transientPoolOptions() });
  const prisma = new PrismaClientClass({ adapter, log: ['error'] });

  return {
    prisma,
    disconnect: () => prisma.$disconnect(),
  };
}
