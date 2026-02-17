/**
 * Cleanup Expired Export Jobs
 *
 * Scheduled job that deletes ExportJob records where expiresAt < NOW().
 * Runs hourly to free PostgreSQL TOAST storage from large export files.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';

const logger = createLogger('cleanupExpiredExports');

export async function cleanupExpiredExports(prisma: PrismaClient): Promise<{ deleted: number }> {
  const result = await prisma.exportJob.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (result.count > 0) {
    logger.info({ deleted: result.count }, '[Cleanup] Deleted expired export jobs');
  }

  return { deleted: result.count };
}
