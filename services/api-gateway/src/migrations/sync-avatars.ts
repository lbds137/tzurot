/**
 * Avatar Sync: Sync avatars from database to filesystem cache
 *
 * Database is source of truth. On startup, check if avatar files exist
 * on the volume. If they don't exist, decode base64 from DB and write files.
 *
 * This replaces the old migrate-avatars.ts approach which bundled files
 * in the deployment.
 */

import { writeFile, access } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('avatar-sync');
const prisma = new PrismaClient();

export async function syncAvatars(): Promise<void> {
  logger.info('[Avatar Sync] Starting avatar sync from database...');

  try {
    // Query all personalities with avatar data
    const personalities = await prisma.personality.findMany({
      where: {
        avatarData: { not: null },
      },
      select: {
        slug: true,
        avatarData: true,
      },
    });

    if (personalities.length === 0) {
      logger.info('[Avatar Sync] No personalities with avatar data found');
      return;
    }

    logger.info(`[Avatar Sync] Found ${personalities.length} personalities with avatars`);

    let syncedCount = 0;
    let skippedCount = 0;

    for (const personality of personalities) {
      const avatarPath = `/data/avatars/${personality.slug}.png`;

      try {
        // Check if file already exists
        await access(avatarPath);
        logger.debug(`[Avatar Sync] Avatar already exists: ${personality.slug}`);
        skippedCount++;
        continue;
      } catch {
        // File doesn't exist, create it from DB
      }

      // avatarData is already raw bytes, just write to file
      const buffer = Buffer.from(personality.avatarData!);
      await writeFile(avatarPath, buffer);

      const sizeKB = (buffer.length / 1024).toFixed(2);
      logger.info(`[Avatar Sync] Synced avatar: ${personality.slug} (${sizeKB} KB)`);
      syncedCount++;
    }

    logger.info(`[Avatar Sync] Complete. Synced: ${syncedCount}, Skipped: ${skippedCount}`);
  } catch (error) {
    logger.error({ err: error }, '[Avatar Sync] Failed to sync avatars');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
