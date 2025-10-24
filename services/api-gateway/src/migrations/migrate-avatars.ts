/**
 * One-time migration: Copy avatars from repo to volume
 *
 * This migration copies avatar files bundled with the deployment
 * to the persistent /data/avatars volume.
 */

import { copyFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('avatar-migration');
const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  {
    source: join(__dirname, '../../avatars-to-migrate/lilith-tzel-shani.png'),
    dest: '/data/avatars/lilith-tzel-shani.png',
    name: 'lilith-tzel-shani'
  }
];

export async function migrateAvatars(): Promise<void> {
  logger.info('[Migration] Starting avatar migration...');

  // Ensure destination directory exists
  await mkdir('/data/avatars', { recursive: true });

  for (const migration of MIGRATIONS) {
    try {
      // Check if destination already exists
      try {
        await access(migration.dest);
        logger.info(`[Migration] Avatar already exists: ${migration.name}`);
        continue;
      } catch {
        // Doesn't exist, proceed with copy
      }

      // Check if source exists
      try {
        await access(migration.source);
      } catch {
        logger.warn(`[Migration] Source avatar not found: ${migration.source}`);
        continue;
      }

      // Copy file
      await copyFile(migration.source, migration.dest);
      logger.info(`[Migration] Copied avatar: ${migration.name}`);

    } catch (error) {
      logger.error({ err: error }, `[Migration] Failed to migrate ${migration.name}`);
    }
  }

  logger.info('[Migration] Avatar migration complete');
}
