/**
 * Prisma Client Service
 * Provides a singleton Prisma client for database access across services
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../logger.js';

const logger = createLogger('PrismaService');

let prismaClient: PrismaClient | null = null;

/**
 * Get or create the Prisma client singleton
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    });

    logger.info('Prisma client initialized');
  }

  return prismaClient;
}

/**
 * Disconnect the Prisma client (for graceful shutdown)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
    logger.info('Prisma client disconnected');
  }
}
